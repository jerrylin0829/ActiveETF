# Generator handoff — Dashboard 第三片：新倉雷達超額報酬快取

Planner：Claude Code ｜ 日期：2026-07-17 ｜ 目標分支前綴：`codex/`

**狀態：已核可，可開工。** 2026-07-17 User 裁決：兩個 ⚖️ 項皆採 Planner 建議（A 案）——存量持股排除、海外持股列入但超額報酬顯示「不適用」。六個設計決策全部定案。

## Goal

把首頁新倉雷達的「買進至今超額報酬」從「待上線」佔位換成真數字（主 spec §7 ①）。計算在 pipeline 端做並快取（鐵則：前端只 SELECT），每日更新，> ±10% 標色紅漲綠跌。

## 設計決策（回答 Evaluator 提出的六個問題）

### 1. 超額報酬公式與基準日期

- 公式：`超額報酬 = 個股還原價報酬 − 加權報酬指數（TAIEX_TRI）同期報酬`（主 spec §6：個股層級基準 = 加權報酬指數，一律還原價）
- 視窗：`entry_date（NEW 事件日）→ 最新有還原價的交易日`，兩端皆取還原收盤價——與勝率計分視窗同一定義，**直接重用 `metrics.py` 的 `_window_return()` 與 `load_tri_series()`**，不得另寫第二套報酬計算
- 理由：PCF 是收盤後組合，事件日收盤價是最接近的可執行價；與 `picking_win_rate` 一致可互相對帳

### 2. Cache table schema 與唯一鍵

「當前狀態」表，每日全表重算（部位數 ≤ 數百，重算最簡單且冪等），可從 `holding_change` + `stock_price` 全期重建（符合資料原則 1）：

```sql
create table radar_position (
  etf_id            text not null references etf,
  stock_id          text not null,
  entry_date        date not null,            -- NEW event date of the current round
  as_of_date        date not null,            -- last recompute date
  holding_days      int not null,             -- trading days since entry (entry day = 0)
  stock_return_pct  numeric(10,4),            -- adj-close return, entry -> as_of
  bench_return_pct  numeric(10,4),            -- TAIEX_TRI return, same window
  excess_return_pct numeric(10,4),            -- stock - bench; null if stock price missing
  primary key (etf_id, stock_id, entry_date)
);
-- RLS 比照既有表：enable + anonymous read policy
```

只存「未平倉且 holding_days < 20」的部位；EXIT 或畢業者在重算時自然消失。

### 3. EXIT、重新 NEW、TRIM 的處理

- 回合切分**直接重用 `metrics.py` 的 `build_rounds()`**：EXIT 結束回合（移出雷達）；EXIT 後再 NEW = 新回合、新 `entry_date`；TRIM 不結束回合、不影響 entry_date；ADD 同樣不影響
- ✅ 已裁決（2026-07-17）：資料起始日之前就存在的持股（首日快照就有、無 NEW 事件）**明確排除**——沒有可信的 entry_date，寧缺勿錯

### 4. 20 個交易日的計算

- 交易日序列 = `holdings_snapshot` 的 distinct `trade_date`（與第二片同一慣例）
- `holding_days` = 序列中落在 `(entry_date, as_of_date]` 的交易日數（entry 當天 = 0）
- 滿 20（`holding_days >= 20`）= 畢業，不寫入 `radar_position`；「長抱」徽章屬 ETF 個別頁（第四片），本片不做
- 實作時先檢查 `score_rounds` 的天數計算是否同一口徑，若有現成函式必須重用

### 5. 海外持股

- ✅ 已裁決（2026-07-17）：**照樣列入雷達**（持有天數、「N 檔同步建倉」共同訊號照算），但 `excess_return_pct` 為 null、前端顯示「不適用」——台股加權報酬指數對海外標的不是有意義的基準；完全隱藏則違反「缺資料要可見」精神
- 個股還原價缺漏（yfinance 抓不到）同樣以 null 呈現，不湊數

### 6. Pipeline 更新與 backfill 策略

- 每日 pipeline 在 `metrics.compute_all(today)` 之後呼叫 radar 重算（同 `refresh_daily_aggregates` 的掛載位置與模式：delete 全表 + insert，單一 transaction）
- 不需獨立 backfill 腳本：表是當前狀態，首次部署後跑一次重算函式即初始化（提供 `scripts/` 下的薄包裝或直接跑 pipeline 皆可）

## Scope

1. Migration：`radar_position` 表 + RLS（編號接在既有 migration 之後）
2. `db.py` / `metrics.py`：重算函式（重用 `build_rounds`、`_window_return`、`load_adj_series`、`load_tri_series`）
3. pipeline 掛載重算步驟
4. 前端：把今日總覽雷達的「待上線」欄位換成 `radar_position.excess_return_pct`，`abs ≥ 10%` 標色（紅漲綠跌）、null 顯示「不適用」；數字格式沿用 `+12.33%` 規範（交集表 spec §7）
5. pytest 整合測試：回合切分邊界（EXIT 後再 NEW、TRIM 不斷回合、無 NEW 事件的存量持股排除）、天數計算、缺價 null、冪等重跑

## Non-goals

- 「長抱」徽章與 ETF 個別頁
- 任何前端報酬計算
- 改動既有 `holding_change` 語意或 `metrics` 的勝率計算

## Context to Read

- `CLAUDE.md`、主 spec §6（指標規則）、§7 ①（雷達需求原文）
- `scraper/src/activeetf/metrics.py`（`build_rounds` / `_window_return` / `score_rounds`——重用，勿重造）
- `scraper/migrations/003_cross_holdings_rotation.sql` 與 `db.refresh_daily_aggregates()`（彙總表的既定模式）
- `web/components/today-overview-dashboard.tsx`（雷達現有渲染與「待上線」佔位）

## Expected Files

- `scraper/migrations/004_radar_position.sql`
- `scraper/src/activeetf/`（radar 重算，掛進 pipeline）
- `scraper/tests/test_radar.py`
- `web/lib/today-overview*.ts`、`web/components/today-overview-dashboard.tsx` 及測試

## Acceptance Criteria

- 整合測試涵蓋 Scope 5 全部邊界；`uv run pytest` 全綠
- 雷達欄位顯示真實超額報酬、±10% 標色正確、海外/缺價顯示「不適用」
- `npm run build` / `lint` / `test` 通過；真資料 smoke：正式站雷達區塊逐檔核對一檔部位的超額報酬（手算 `adj_close` 比值驗證）

## Risks

- `build_rounds` 目前為勝率設計，重用時注意它對「資料起始日前存量持股」的行為是否與本片排除規則一致——不一致就在 radar 層過濾，不要改 `build_rounds` 本身
- TAIEX_TRI 快取缺日會讓 bench 報酬為 null——沿用 `load_tri_series` 的既有補抓邏輯即可，不要另開資料來源

## Handoff Prompt

請以 Codex Generator 身分依本 handoff 實作（**User 核可六個設計決策後才開工**）。完成後開 PR（base `main`），PR body 含變更摘要、驗證輸出、真資料 smoke 證據（含手算對帳一筆超額報酬）、已知風險。不得在未驗證時宣稱完成；報酬計算必須重用 metrics.py 既有函式。
