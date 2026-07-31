# PR #20 正式 gate 前置清單

Planner：Claude Code ｜ 日期：2026-07-31 ｜ 對象：PR #20 `codex/historical-backfill`（head `2427e84`，Draft）

Codex Evaluator 已判定「無 code blocker、三項 P1 均正確閉環」。本文件只處理**進入正式 gate 之前**該補的事，分成兩類：可交給 Generator 的（A、B）與只能由 User 或授權 session 執行的（C）。

---

## A. PR body 文字修正（交給 G，10 分鐘，不動 code）

### A-1 更新 exact head

PR body 的「Evaluator P1 修正」段落仍寫 `Exact head：df6b6ab`，但 `gh pr view 20 --json headRefOid` 為 `2427e84e55908947566b8ad0640bc7a88f257c74`。該行的作用是宣告「以下修正對應哪個 commit」，指到舊 head 等於驗收基準對不上。改成 `2427e84`。

### A-2 補上 canary 驗收清單

**這一項的背景比 Evaluator 講的更嚴重：`backfill_history.py` 的 `main()` 在所有正常路徑都 `return None`，canary 必定 exit 0。** 不論驗證失敗有沒有發生、抓到什麼、寫進去什麼，exit code 永遠是 0——目前完全無法用 exit code 判斷 canary 成敗。

腳本本身有印出計數器（`scripts/backfill_history.py:202-205`：成功／已有快照跳過／驗證失敗／抓取失敗），資訊是齊的，缺的是 PR body 沒有告訴執行者要核對什麼。現行 gate 第 3 步只有一行指令；「回補後 smoke／對帳」第 2 點只涵蓋四項中的兩項（snapshot 為 0、有 failure log），**缺計數器核對與 `50.80` 字串比對**。

`50.80` 那項不能省——它在確認失敗原因是預期的權重總和問題（`weight sum 50.80 outside [70.0,101.0]`），而不是碰巧遇到網路錯誤也被算成失敗。少了它，一次 fetch timeout 就會讓人誤判 canary 通過。

請把 gate 第 3 步改寫為：

````markdown
```bash
uv run python scripts/backfill_history.py --etf-id 00990A --date 2025-12-15
```

**不可只看 exit code——`main()` 永遠回 `None`，canary 必定 exit 0。**
腳本輸出的末行必須是：`成功 0、已有快照跳過 0、驗證失敗 1、抓取失敗 0`

再核對 DB：

```sql
select count(*) from holdings_snapshot
 where etf_id = '00990A' and trade_date = '2025-12-15';
-- 必須為 0

select status, error from scrape_log
 where etf_id = '00990A' and trade_date = '2025-12-15'
 order by id desc limit 1;
-- 必須 status = 'fail'，且 error 內含 '50.80'
```

四項有任一不符即停止，不得往下執行完整回補。
````

### A-3（選作，G 自行判斷是否值得）

在 canary 模式加一個 `--expect-validation-failure` 旗標，不符預期就 `raise SystemExit(1)`，讓 exit code 恢復意義。屬 nice-to-have，A-2 的人工清單已足以進 gate。

---

## B. 回補前的一次性查證（交給 G，唯讀，禁止寫 DB）

### B-1 六支 `fetch_at` adapter 的日期偏移驗證

**問題**：六支支援 `fetch_at` 的 adapter（`uni`、`yuanta`、`cathay`、`fsitc`、`allianz`、`ctbc`）**沒有任何一支核對「回傳資料的日期」與「請求的日期」是否相符**。上游若對日期參數的語意與我方假設不同，回補會把資料寫在錯誤的 `trade_date`，而三道驗證完全擋不住（權重、筆數、代號都正常）。因為 `holding_change` 是從 snapshot 歷史重建的，錯位會連帶讓整段歷史的異動事件失真。

**Planner 已實測 fsitc（2026-07-31，三次請求）：**

| 送出 `pStrDate` | 回傳 `sdate` | 持股數 |
|---|---|---|
| `''`（最新） | `2026-07-29` | 34 |
| `'2026/07/01'` | `2026-06-30` | 39 |
| `'2026/07/28'` | `2026-07-27` | 35 |
| `'2025/01/02'`（上市前） | 空回應 | 0 |

**結論（fsitc 部分）：**
- ✅ 上游**真的認得歷史日期**——回的是不同持股、不同股數，不是拿最新資料充數。我原先擔心的「送歷史日期卻拿到今日資料並靜默寫入」情境**不成立**。
- ✅ 超出範圍回空 → 現行 `empty holdings` 驗證擋得住。
- ⚠️ **回傳日期一律是請求日的前一交易日（T-1）**，不等於請求日。
- ✅ 但這與每日路徑**一致**：每日 pipeline 在第 T 日以 `''` 抓取，拿到 T-1 的資料，寫在 `trade_date = T`；回補請求 D、拿到 D-1、寫在 `trade_date = D`。兩條路徑的偏移相同，所以**銜接處不會錯開**。

**要 G 做的**：對**其餘五支** adapter 各做同樣的三次探測（最新、一個已在 DB 有快照的日期、一個上市前日期），確認每支的偏移量與其每日路徑一致。**請節制請求頻率**（每次間隔 ≥ 2 秒）。

**判定標準**：對某支 adapter，請求日期 D 取得的持股，應與 DB 中 `trade_date = D` 的既有快照**完全相同**（股數逐檔相等）。不同即代表該 adapter 的偏移與每日路徑不一致，**該支必須排除於本次回補之外**，另行處理。

**產出**：一張六支 adapter 的對照表（請求日 → 回傳日 → 與 DB 既有快照是否一致），寫進 PR body。

### B-2 順帶記錄（不修）

`fsitc.parse()` 讀得到 `sdate` 欄位卻整個丟棄；`pipeline.scrape_one` 以執行當日 `today` 寫入（`pipeline.py:35`）。目前兩條路徑的偏移恰好一致所以運作正常，**但沒有任何程式碼斷言這件事**。建議未來讓 adapter 回傳 `(holdings, source_date)` 並在寫入前核對，屬 spec §5 層級的改動，**不在本片範圍**，僅在 PR body 記錄。

---

## C. 只能由 User 或授權 session 執行

Evaluator 給的順序維持不變，B-1 插在最前面：

```
B-1 六支 adapter 日期偏移驗證（G 可做，唯讀）
  → migration（006_etf_history_range_view.sql）
  → 真 DB integration test
  → 00990A bounded canary（依 A-2 清單四項核對）
  → 完整回補
  → aggregates / metrics 重算
  → production smoke
  → merge
```

注意事項沿用 PR body 已載明的：事件重建會鎖 `holdings_snapshot` 與 `holding_change` 兩張表，**必須避開每日 18:30 主場與 21:30 補抓**，執行前確認沒有 Actions pipeline 正在跑（`gh run list --limit 3`）。

Migration 未套用前 Preview 會顯示「歷史範圍讀取異常」黃條——PR body 已正確記載此為預期狀態，不得當作最終 smoke 通過。

---

## 附註：兩則已排除的疑慮

Planner 在 2026-07-31 稍早根據**過期的頁面讀取**提出過兩個問題，經重新查證後**均不成立**，記錄於此以免後續有人重複調查：

1. **「pipeline 停了 3 個交易日」——不成立。** `gh run list` 顯示 07-27、07-28、07-29 六次排程全部 success；07-29 的 run log 末行為「完成。已實作 28 檔，失敗 0: []」。pipeline 健康。
2. **「00981A 只解析出 37 檔、疑似漏長尾」——不成立。** 正式站現況為最新快照 `2026-07-29`、持股 **51 檔**、權重加總約 88.7%，與 Evaluator 的 Preview 觀察（51 rows）及外部來源一致。原先讀到的「07-24 / 37 檔」是過期的頁面快取。

**因此不需要在回補前做 00981A 的持股完整性對帳。** PR #20 的資料完整性沒有新增疑慮。
