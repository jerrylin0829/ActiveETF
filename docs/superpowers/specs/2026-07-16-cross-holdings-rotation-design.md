# 交集表與產業權重輪動 — 設計文件

日期：2026-07-16
狀態：已與 User 逐段確認
關係：本文件為 `2026-07-04-active-etf-tracker-design.md` §7 Dashboard 的擴充，新增頁面⑤（交集表）與⑥（產業權重輪動）。資料原則（append-only、三道驗證、事件定義、紅漲綠跌）全數沿用主 spec，不另立規則。

## 1. 背景與目標

參考 etfcross.com 的「主被動 ETF 交叉持股」視角：該站把多檔 ETF 的持股疊起來，呈現市場共識持股與產業資金輪動，但只收錄 8 檔主動 ETF（規模前段班、5 家投信）。本專案已全覆蓋所有已掛牌主動式股票型 ETF（檔數以 `etf` 表為準），`holdings_snapshot` 足以計算同類視圖且覆蓋面更完整。

目標：新增兩個橫向聚合視角，補足現有「一檔一檔看異動」的縱向視角——

1. **交集表**：每檔股票被幾檔主動 ETF 持有、合計權重多大、當日有幾檔在買賣
2. **產業權重輪動**：全體主動 ETF 的資金正從哪個產業流向哪個產業

## 2. 範圍

**納入**：
- 兩張每日衍生表 + pipeline 彙總步驟 + 一次性 backfill
- 前端新頁 `/cross`（交集表）與 `/rotation`（產業權重輪動）
- 「獨門持股」= 交集表「涵蓋檔數 = 1」的篩選選項，不另做頁面

**不納入**：
- 被動式 ETF（User 明確排除）
- 使用者帳號、筆記、推播通知（etfcross 的社群層，非本專案方向）
- 自建供應鏈細分產業分類（採交易所產業別，理由見 §4）

## 3. 資料層

### 3.1 `cross_holdings_daily`（交集表資料）

每股每日一列，由 pipeline 從 `holdings_snapshot` + `holding_change` + `stock_price` 聚合：

```sql
create table cross_holdings_daily (
  trade_date       date not null,
  stock_id         text not null,
  etf_count        int not null,               -- 涵蓋檔數（持有該股的主動 ETF 數）
  total_weight_pct numeric(10,4) not null,     -- Σ 各 ETF 對該股的權重（單位：%）
  total_shares     bigint not null,            -- Σ 持有股數（單位：股）
  total_value_twd  numeric(20,2),              -- Σ 股數 × 當日收盤價（單位：新台幣元）；缺價則 null
  new_count  int not null default 0,           -- 當日 NEW 事件的 ETF 檔數
  add_count  int not null default 0,           -- 當日 ADD 事件的 ETF 檔數
  trim_count int not null default 0,           -- 當日 TRIM 事件的 ETF 檔數
  exit_count int not null default 0,           -- 當日 EXIT 事件的 ETF 檔數
  primary key (trade_date, stock_id)
);
```

設計決定：
- **不存持有 ETF 清單（JSON）**：使用者展開某股票時，前端直接查 `holdings_snapshot` 與 `holding_change`（單股單日 ≤ 27 列），避免反正規化
- **金額**：`股數 × stock_price.close`；海外股票或當日缺價者為 null，不湊數
- **異動計數**直接彙總 `holding_change`，沿用主 spec 事件定義（股數變化 + 權重變化 ≥ 0.05pp 同時成立），不另創第二套異動規則

### 3.2 `industry_weight_daily`（產業輪動資料）

每產業每日一列：

```sql
create table industry_weight_daily (
  trade_date       date not null,
  industry         text not null,              -- stock_info.industry；為空者歸「未分類」
  sum_weight_pct   numeric(12,4) not null,     -- Σ 全體主動 ETF 在該產業的權重（單位：%）
  stock_count      int not null,               -- 該產業被持有的不重複股票檔數
  etf_count_total  int not null,               -- 當日有快照的主動 ETF 檔數（平均值分母）
  primary key (trade_date, industry)
);
```

- 前端顯示的「產業權重」= `sum_weight_pct / etf_count_total`，即**全體主動 ETF 的平均配置**，全產業加總 ≈ 100%
- 分母存進表中是為了資料缺口透明：某日僅 N/M 檔有資料時（M = `etf` 表中該日已掛牌檔數）平均仍正確，且前端可據此顯示黃條

### 3.3 Pipeline 與 backfill

- 每日流程在寫完 snapshot 與 events 後，依序執行：`metrics.compute_all` → `cache_daily_holding_closes`（補當日仍缺未還原收盤價的台股持股，海外持股經 `stock_info` join 天然排除）→ 彙總步驟（2026-07-17 補記：close 快取為金額欄的資料前提，實作於 PR #9 評審期）
- 彙總步驟：單一 `insert ... select` 在 DB 端聚合；先 `delete` 當日再 `insert`，重跑冪等
- 兩表皆可從 `holdings_snapshot` 全期重算（符合主 spec 資料原則 1）；新增一次性腳本 `scripts/backfill_aggregates.py` 補齊上線以來全部歷史，輪動圖上線首日即有完整時間序列
- RLS：比照既有表，匿名唯讀

## 4. 產業分類

採 FinMind `stock_info` 的交易所產業別（約 30 類）：零人工維護、新股自動歸類、與主 spec §7③ 產業圓餅圖同一套分類。不採 etfcross 式自建供應鏈細分（需人工維護個股歸類表，新進股票會漏分類，違反「錯資料比缺資料危險」原則）。`industry` 為空的股票（含海外股）一律歸「未分類」並照常顯示。

## 5. 頁面⑤：交集表（`/cross`）

版面沿用既有模式：`site-nav` 新增「交集表」，頁首為 `date-selector`（預設最新交易日）＋資料缺口黃條（當日缺快照時註明「本表基於 N/M 檔資料」；分母 M = `etf` 表中該日已掛牌的主動 ETF 檔數，不寫死 27）。

**主表格**（每列一檔股票）：

| 欄 | 內容與單位 | 來源 |
|---|---|---|
| 代號 / 名稱 | 名稱預留連結至個股反查頁（主 spec §7④ 建成後啟用） | `stock_info` |
| 產業 | 交易所產業別 | `stock_info` |
| 涵蓋檔數 | 單位：檔；**預設排序鍵（降冪）** | `cross_holdings_daily` |
| 合計權重 | 單位：%，如 `12.33%` | 同上 |
| 合計金額 | 單位：億元（新台幣），如 `27.50 億` | 同上（缺價顯示 `—`） |
| 合計張數 | 單位：張（1 張 = 1,000 股），千分位 | 同上 |
| 當日異動 | 徽章：`新進×N`／`加碼×N`／`減碼×N`／`出清×N`；新進與加碼紅、減碼與出清綠 | 事件計數欄 |

**列展開**（點列展開，不跳頁）：該股被哪些 ETF 持有——ETF 名稱、權重（%）、張數、當日異動類型。前端即時查 `holdings_snapshot` + `holding_change`。

**篩選列**（client-side）：
- 涵蓋檔數：`全部 / ≥2 / ≥3 / ≥5 / 獨門(=1)`
- 產業：下拉多選
- 「只看當日有異動」開關

**排序**：預設涵蓋檔數降冪、次鍵合計權重降冪；各數值欄可點擊排序。

**手機響應式**：窄螢幕收合金額與張數欄，保留代號、涵蓋檔數、合計權重、異動徽章。

**空狀態**：選定日期無彙總資料時顯示「該日無資料」並提示最近有資料日；不顯示零值假資料。

## 6. 頁面⑥：產業權重輪動（`/rotation`）

版面：上圖下表。

**上：輪動折線圖**（Recharts）
- X 軸 = 交易日；Y 軸 = 平均權重（%）
- 預設畫當日權重前 6 大產業，圖例可勾選增減（避免 30 類麵條圖）
- 時間範圍切換：`1M / 3M / 6M / 全部`（「全部」= 資料起始日起）
- tooltip 顯示日期與各產業權重；配色用主題 token，深色模式原生支援

**下：產業總表**（每產業一列）：

| 欄 | 內容與單位 |
|---|---|
| 產業 | 交易所產業別；空值歸「未分類」 |
| 當日平均權重 | 單位：%，如 `18.42%`；預設排序鍵（降冪） |
| 5 日變化 | 權重差，以 % 呈現、帶正負號，如 `+1.25%`；紅漲綠跌 |
| 20 日變化 | 同上，如 `-0.87%`；紅漲綠跌 |
| 持股檔數 | 單位：檔（不重複股票數） |

- 點表格某產業 = 在圖表勾選該產業
- 5 日/20 日變化以「交易日」計，跨越缺資料日照算不中斷
- 圖表的時間範圍切換**只影響顯示**：5 日/20 日變化永遠以完整序列計算，不受範圍篩選影響（2026-07-17 補記，實作於 PR #9 評審期）

**資料缺口**：`etf_count_total` 小於全體檔數的日期照畫（平均值仍正確）；檢視當日時黃條註明基於幾檔資料。

## 7. 數字格式規範（兩頁通用）

- 所有權重與權重變化一律以 `%` 呈現，**最多小數第二位**；變化值帶正負號（如 `+12.33%`）。UI 不出現「pp」字樣
- 金額單位為新台幣億元，最多小數第二位（如 `27.50 億`）
- 張數以千分位整數呈現（1 張 = 1,000 股）
- 數字欄位使用等寬數字字型（tabular-nums）
- 漲跌標色遵循台股習慣：紅漲綠跌

## 8. 前端技術決策

- 新增依賴：**Recharts**（經 shadcn/ui chart 元件使用），供輪動折線圖與未來個別頁權重折線；除此之外不新增 UI 套件，維持 Next.js + Tailwind + shadcn/ui
- 視覺品質：實作時套用 `frontend-design` skill；全站深色模式優先、漲跌紅綠為僅有的強調色、數字等寬
- 前端只 SELECT，不做聚合計算（主 spec 原則）

## 9. 測試

- **彙總 SQL**：pytest 整合測試（無 `SUPABASE_DB_URL` 時自動 skip，比照既有慣例）——造假快照與事件資料，驗證兩張表的檔數、合計權重、事件計數、缺 ETF 日的 `etf_count_total`
- **backfill**：對固定測試資料執行後與每日彙總結果一致（冪等性）
- **前端**：比照 `rankings-table.test.tsx` 的 Vitest 模式——排序、篩選（含獨門）、列展開、空狀態、缺口黃條、數字格式（`+12.33%`）

## 10. 未來擴充（本次不做）

- 產業輪動：全體 ↔ 單一 ETF 切換
- 產業點擊下鑽至成分個股（該產業內個股合計權重與近期異動）
- 交集表「規模（AUM）加權」視角：避免小 ETF 與大 ETF 在涵蓋檔數上等權灌票
- 交集表「涵蓋檔數 20 日趨勢」欄（共識升溫/降溫）
- 個股反查頁（主 spec §7④）建成後，交集表股票名稱連結導向該頁
