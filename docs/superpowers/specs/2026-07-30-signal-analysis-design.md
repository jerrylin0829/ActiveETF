# 訊號實證分析（`/signal`）— 設計文件

日期：2026-07-30
狀態：已與 User 逐段確認
關係：主 spec `2026-07-04-active-etf-tracker-design.md` §6（指標定義）、§7（頁面）之延伸；新增頁面 `/signal`，主 spec §7 需增列。

## 0. 硬性前置（兩項，實作排序用，勿略過）

### 0.1 歷史回補

三個指標**全部依賴歷史深度**。截至本文件日期，`holdings_snapshot` 僅約 10 個交易日：

- 60 個交易日的前瞻報酬**一列都算不出來**
- ③的進場後 20 日窗口幾乎全部未到期
- ②的 `etf_count_at_entry` 只有極少數日期可取

必須排在歷史回補（`docs/superpowers/specs/2026-07-25-historical-backfill-design.md`）完成之後。

### 0.2 `backfill_aggregates.py` 重跑

②讀 `cross_holdings_daily.etf_count`，而該表由 `db.refresh_daily_aggregates(d)` **逐日重算**——現有歷史列是 PR #19（觀察部位）合併**之前**產生的，仍把 14 筆觀察部位計入 `etf_count`；歷史回補新增的交易日則**根本還沒有列**。

§4.2 取的正是**進場當日**的值，完全落在這些過期或缺漏的列上。這是本設計最容易安靜出錯的一處：程式碼是對的、資料是舊的，②的共識分組會系統性偏高而沒有任何錯誤訊號。

**因此：回補完成後、實作 `/signal` 之前，必須由 User 或授權 session 對全部交易日重跑 `scripts/backfill_aggregates.py`。** Generator 不得執行；實作前應先確認該表已重算（抽查任一已知含觀察部位的股票，其 `etf_count` 已下降）。

> 兩項前置皆未完成前，本設計與其 plan 可先寫，但不應進入 Generator 佇列——否則做出來的是一個空頁面或一組錯數字，且無法驗收。

## 1. 目標

主動式 ETF 的價值主張是「經理人選股」。目前 Dashboard 呈現的是**發生了什麼**（異動、權重、交集），缺的是**這些動作事後看有沒有用**。三個指標回答三個不同的問題：

| # | 問題 | 指標 |
|---|---|---|
| ① | 經理人買進後，股票表現如何？ | 建倉後 5／20／60 個交易日的超額報酬分布 |
| ② | 大家都買的股票，比獨門股表現好嗎？ | 依進場當日被幾檔 ETF 持有分組，比較①的結果 |
| ③ | 經理人買在相對高點還是低點？ | 進場日收盤價在「前後各 20 交易日」區間的百分位 |

三者共用同一組進場事件，故共用同一張衍生表。

## 2. 進場事件的定義（採選股勝率的定義，非雷達的定義）

既有程式碼對「進場」有兩種用法：

- `metrics.score_rounds()`（選股勝率）餵**全部事件**給 `build_rounds()` → NEW **與**股數增幅 ≥ `ADD_EVENT_MIN_SHARE_GROWTH`（10%）的 ADD 皆為一次進場
- `metrics.refresh_open_positions()`（新倉雷達）只餵 NEW/EXIT → 大額加碼不產生雷達回合（見該函式註解）

**本設計採前者**：加碼是明確的看多訊號；三個指標問的是「訊號事後有沒有用」，不是「新倉追蹤」。雷達的窄定義是為了頁面不被灌爆，目的不同，兩者不需一致，但**此差異必須在程式碼註解中寫明**，以免日後被誤當成不一致的 bug 而「修正」。

同一 ETF 對同一股票多次進場（加碼）會產生多列；主鍵天然容納。

## 3. 資料模型

```sql
-- 007_signal_event.sql
create table signal_event (
  etf_id      text not null references etf,
  stock_id    text not null,
  entry_date  date not null,            -- 進場事件日（NEW 或 ADD>=10%）
  as_of_date  date not null,            -- 本次重算日

  etf_count_at_entry int,               -- 進場當日被幾檔 ETF 實質持有（②分組用）

  -- ① 前瞻超額報酬（個股還原價報酬 − TAIEX_TRI 同期），單位 %
  fwd_5d_excess_pct   numeric(10,4),
  fwd_20d_excess_pct  numeric(10,4),
  fwd_60d_excess_pct  numeric(10,4),
  fwd_5d_mature   boolean not null,     -- false = 窗口未滿，值為「至今」報酬
  fwd_20d_mature  boolean not null,
  fwd_60d_mature  boolean not null,

  -- ③ 進場點價格區間百分位（0=區間最低、100=最高）
  entry_percentile        numeric(6,2),
  entry_percentile_mature boolean not null,   -- 進場後 20 日是否已滿

  primary key (etf_id, stock_id, entry_date)
);

alter table signal_event enable row level security;
create policy signal_event_read on signal_event for select using (true);
```

設計要點：

- `*_mature` 旗標是「折衷方案」（§5）的載體——前端據此把完整到期與未到期分開統計，不需存兩組數字
- 全表每日重算，可自 `holding_change` + `stock_price` 完全重建，符合資料原則 1
- 海外持股：TAIEX_TRI 不具可比性 → 三個 `*_excess_pct` 為 `null`（沿用主 spec §6 既有處理）；若有還原價則 `entry_percentile` 仍可算
- **不新增欄位到既有表**，不動 `open_position`（其語意為「當前未平倉」，與本表的「歷史事件樣本」不同）

## 4. 指標定義

### 4.1 ① 前瞻超額報酬

```
fwd_Nd_excess = 個股(entry_date → entry_date + N 交易日)還原價報酬
              − TAIEX_TRI 同期報酬
```

- N ∈ {5, 20, 60}，皆為**交易日**（沿用 `db.snapshot_trading_dates()` / 0050 交易日序列的既有慣例）
- 用共同價窗：重用 `metrics._common_window_returns()`，兩邊各取「該日或之前最近的可用交易日」，避免單邊缺價造成假差異
- 窗口未滿 N 日 → 終點取最新可用交易日，`fwd_Nd_mature = false`
- 無價（海外、新上市無足夠歷史）→ `null`，且不計入任何統計

### 4.2 ② 共識分組

`etf_count_at_entry` 取自 `cross_holdings_daily`（`trade_date = entry_date`, `stock_id`）的 `etf_count`。PR #19 起該欄位的**計算邏輯**已排除觀察部位，但**既有資料列尚未重算**——見 §0.2，實作前必須確認 `backfill_aggregates.py` 已對全部交易日重跑。若該日該股無列，記 `null` 並排除於分組統計外（回補完成且重算後，此情形應僅出現於資料邊界）。

前端分三組：

| 組別 | 條件 |
|---|---|
| 獨門 | `etf_count_at_entry = 1` |
| 少數 | `2–3` |
| 共識 | `>= 4` |

門檻寫在**前端常數**（`web/lib/signal.ts`），不入 DB——回補後若共識組樣本過少，可改為 1 / 2 / ≥3 而無需重算資料。改動須同步本節。

### 4.3 ③ 進場點百分位

```
區間 = [entry_date − 20 交易日, entry_date + 20 交易日] 的還原價最高／最低
entry_percentile = (進場日收盤 − 區間最低) / (區間最高 − 區間最低) × 100
```

- 0 = 買在區間最低（完美抄底）、100 = 買在最高
- 區間最高 = 最低（停牌等極端情形）→ `null`
- 進場後 20 日未滿 → 以現有日數計算，`entry_percentile_mature = false`
- 進場前 20 日不足（該股上市未久）→ 以現有日數計算，**不**因此標為未到期（前段資料永遠不會再增加，等待無意義）

**此指標使用進場之後的價格，屬事後評估。** 頁面必須顯示警語（§6）。

## 5. 未到期樣本的處理（折衷方案）

每個窗口的統計**主數字只用 `mature = true` 的樣本**，未到期樣本另列一行補述：

```
60 日超額報酬中位數 +2.3%（N=187）
另有 42 件尚未滿 60 日，目前至今中位數 +0.8%
```

理由：混算會用「才過 3 天的事件」污染 60 日統計（存活期偏誤的一種）；完全丟棄則在資料剛回補完時幾乎沒有樣本可看。分列兩者既誠實又不浪費資訊。

樣本數一律顯示（沿用主 spec §6「永遠帶樣本數」）；`N < 10` 沿用既有「樣本不足」淡化規則。

## 6. 頁面設計（`/signal`，導覽列名稱「訊號實證」）

由上而下：

1. **警語條**（頁面頂端，不可折疊）
   > ⚠️ 本頁為**事後統計**，非投資建議。「進場點百分位」使用進場之後的價格計算，屬事後評估、無法即時取得，不可作為跟單依據。
2. **資料期間揭露**：`樣本期間 YYYY-MM-DD ～ YYYY-MM-DD ｜ 共 N 件進場事件`，並註明僅涵蓋有歷史資料的 ETF（與 `dashboard_etf_history_range` 的揭露一致）
3. **① 超額報酬分布**：5／20／60 三個頁籤。每個頁籤顯示中位數、平均、勝率（超額 > 0 的比例）、樣本數，下方直方圖；再下方一行未到期補述
4. **② 共識 vs 獨門**：3 組 × 3 個窗口的表格，每格 `中位數（N=xx）`；空格（樣本 0）顯示 `—`
5. **③ 擇時能力**：百分位直方圖 + 中位數；同樣依②的三組拆開，看共識股是否買得更差（追高）

排版沿用既有 Dashboard 元件（`Card` + Recharts），紅漲綠跌。

## 7. 計算與整合

- `metrics.refresh_signal_events(today)`，於每日 pipeline 的 `holding_change` 更新之後呼叫，**全表重算**（事件數量級同 `holding_change`，成本可接受）。全量重算保證未到期樣本每日推進、`*_mature` 自動翻轉
- 重用既有函式：`build_rounds()`（進場事件）、`_common_window_returns()`／`_window_return()`（報酬）、`load_adj_series()`／`load_tri_series()`（價格）、`db.snapshot_trading_dates()`（交易日）
- 統計聚合（中位數、勝率、分組）在前端對事件列做，**不另建聚合表**。依主 spec §3 的界線，這屬**呈現層聚合**：`signal_event` 這張表本身已在 pipeline 算完，前端只是對「該頁 SELECT 回來的列」做重整，沒有外部抓取、沒有跨日序列運算、沒有超出本頁範圍的掃描。判準是結構性質，不是資料量。
- 資料量只是效能逃生門：目前為千列等級；日後若實測拖慢 TTFB（約萬列以上），再升級為 view 或快取表，屆時前端函式的輸入形狀不變

## 8. 測試

- **`refresh_signal_events` 單元測試**：以假事件 + 假價格序列驗證 5/20/60 三個窗口的起訖取值、未到期時 `mature=false` 且用最新日、無價時 `null`
- **進場定義**：ADD 增幅 9.9% 不產生事件、10.1% 產生事件（鎖住與 `score_rounds` 的一致性）
- **百分位**：買在區間最低 → 0、最高 → 100、區間平坦 → `null`、前段不足仍算且 `mature` 只由後段決定
- **`etf_count_at_entry`**：取進場當日值（非最新日），且不含觀察部位
- **整合測試**：`_T` 假代號、無 `SUPABASE_DB_URL` 自動 skip（沿用慣例）
- **前端**：分組門檻邊界（1／3／4）、未到期補述在 N=0 時不顯示、警語條必存在（快照或明確斷言）

## 9. 風險

- **樣本量在回補完成後仍可能偏小**：12 檔可回補、最長約 13 個月 → 60 日窗口的完整樣本約為前 11 個月的事件。若①的 N 過小，②再拆三組會更小。驗收時須實際看數字，必要時把②的門檻改為 1 / 2 / ≥3（§4.2 已預留為前端常數）
- **多重比較與過度詮釋**：3 個窗口 × 3 組 = 9 個數字，總會有一格看起來很好。頁面**不得**下結論式文案（如「共識股明顯較優」），只呈現數字與樣本數
- **③ 被誤讀為選股訊號**：警語為必要但非充分；元件命名與 tooltip 也應反覆點明「事後」
- **與選股勝率的關係易混淆**：勝率是「進場到出場／至今」的完整回合表現，本頁是「固定窗口的前瞻表現」，兩者可以方向不同。頁面需一句話說明差異

## 10. 不做（YAGNI）

- 不做風險調整（Sharpe、beta 調整超額）——樣本期間太短，反而製造虛假精確
- 不做「出場訊號」的對稱分析（TRIM/EXIT 後的表現）——留待本頁驗證有價值後再議
- 不新增聚合表或 materialized view（§7）
- 不做逐 ETF 的訊號評分排名——極易被誤讀為推薦，且樣本量不支撐
