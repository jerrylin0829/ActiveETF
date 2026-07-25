# Generator handoff — ETF 個別頁「當日成分股貢獻度」歸因

Planner：Claude Code ｜ 日期：2026-07-25 ｜ 目標分支前綴：`codex/`

**狀態：⚖️ 待裁決 6 項，User 拍板前不得開工。**

競品觀察來源：`https://www.etfinfo.tw/etf/00981A`（2026-07-25 實地檢視）。對方在 ETF 頁提供「今日推漲/下跌 Top 3 + 貢獻度排行」，資料需求我方 100% 具備卻未做，是目前投報率最高的缺口。**但對方的算法用當日權重（見 ⚖️#1），我方要用期初權重，數字會不同且更正確。**

## Goal

在 ETF 個別頁（spec §7③）新增「當日成分股貢獻度」區塊：以**前一交易日權重 × 當日還原價報酬**歸因，列出推漲/下跌 Top 3 與貢獻度排行前 10，並顯示「估算 ETF 漲跌」與「實際 ETF 漲跌」兩個數字供對照。這同時是一個**資料品質自檢**——兩者差距過大代表快照或價格有問題。

## 設計決策清單

- ⚖️ **#0 spec 先行**：貢獻度是 spec §6 未定義的**新指標**，須寫入 §6 並在 §7③ 列出。CLAUDE.md：「要改規則就先改 spec（並 commit）」。
  Planner 建議：由 Planner 先補 §6 一小節（公式 + 基準 + 適用範圍）與 §7③ 一行，commit 後 Generator 開工。**User 若選擇同 PR 內改，請明示。**
- ⚖️ **#1 權重基準用「前一交易日」**（`contribution_i = w_i(t-1) × r_i(t)`）。對方用當日權重 `w_i(t) × r_i(t)`——那是錯的：`w_i(t)` 已內含當日漲跌，用它會系統性高估上漲股的貢獻。標準績效歸因一律用期初權重。
  Planner 建議：**採用 t-1 權重**。此為與競品的實質正確性差異，值得在說明文字點出。
- ⚖️ **#2 報酬用 `adj_close`**（還原價），不用 `close`。理由：主 spec §6 鐵則「所有報酬用還原價」；成分股除息日的淨值缺口由基金收到的現金抵銷，用還原價才是對淨值變動的正確歸因。
  Planner 建議：採用 `adj_close`；**個股「當日漲跌」欄位也一併用 `adj_close` 算**，讓「漲跌 × 權重 = 貢獻」在畫面上自洽（對方畫面上這三個數字用不同基礎，讀者無法驗算）。除息日差異寫進 disclaimer。
- ⚖️ **#3 只做 `universe = 'tw'` 的 ETF**。global ETF（00402A、00983A、00986A、00988A、00989A、00990A、00997A、00998A）的 `stock_price` 無海外個股行情——主 spec §1「海外持股範圍限定（v1）」已明定不整合海外行情。
  Planner 建議：global ETF 該區塊顯示「不適用（未整合海外行情）」，**不隱藏區塊**（符合「缺資料要可見」）。
- ⚖️ **#4 當日新進持股（t-1 無權重）排除於歸因之外**，並在區塊註記「本日新進 N 檔未計入歸因」。理由：沒有期初權重就沒有可辯護的貢獻定義，硬用 0 或當日權重都是造數字。
  Planner 建議：採用。同理，當日 EXIT 的持股**應計入**（它在 t-1 有權重、當日有報酬），Generator 需從 t-1 快照而非 t 快照展開歸因清單。
- ⚖️ **#5 顯示「估算」與「實際」兩個 ETF 漲跌**。`估算 = Σ contribution`；`實際` 取 `stock_price` 中以 `etf_id` 為 key 的 `adj_close` 當日報酬（`metrics.py:115` 的 `load_adj_series` 證實 ETF 自身價格就存在同一張表）。兩者必然有差（現金部位、申贖、折溢價、盤中交易、未揭露持股），差額顯示為「未歸因」一列。
  Planner 建議：採用。對方只顯示估算值，我方多這一欄是可驗證性優勢。
- ⚖️ **#6 算在前端 `lib/` 純函式，不新增快取表**。CLAUDE.md 鐵則為「計算一律在寫入時做」，但既有先例 `today-overview.ts:227 aggregateMoves` 已在前端做「股數 × 收盤價」聚合，且 `2026-07-25-change-wall-grouping.md` 的 Non-goals 明文將此類歸為「呈現層聚合」。本片規模同級（單一 ETF、≤ 60 列、資料已在同一次 SELECT 中）。
  Planner 建議：前端純函式。**User 若要求嚴格遵守鐵則，則改為 pipeline 新增 `daily_contribution` 快取表**，工作量約增一倍（migration + 重算 + backfill）。

## Scope

1. **`web/lib/etf-detail.ts`**：新增純函式
   ```ts
   export type ContributionRow = { stockId: string; stockName: string; prevWeightPct: number; returnPct: number; contributionPct: number };
   export type DailyContribution = { rows: ContributionRow[]; estimatedEtfReturnPct: number; actualEtfReturnPct: number | null; unattributedPct: number | null; excludedNewCount: number; missingPriceCount: number; applicable: boolean };
   export function buildDailyContribution(...): DailyContribution
   ```
   - 歸因清單以 **`previous` 快照**（t-1）展開，非 `current`
   - `returnPct = adj_close(t) / adj_close(t-1) - 1`；任一端缺價 → 該股跳過並計入 `missingPriceCount`
   - `rows` 依 `contributionPct` 降冪
2. **`web/lib/etf-detail-data.ts`**：`snapshotResult`（line 279）已同時載入 `latestDate` / `previousDate` / `twentyDayDate` 三份快照，**t-1 權重免費取得**。需新增：查 `stock_price` 取 `(stockIds ∪ {etfId}) × {previousDate, latestDate}` 的 `adj_close`（沿用 `web/lib/today-overview-data.ts:223 fetchDailyCloses` 的分批查詢模式，欄位改 `adj_close`）。ETF 的 `universe` 需從 `etf` 表一併 select（line 257 現只取 `etf_id, name, issuer, listed_date`）。
3. **`web/components/etf-detail/`**：新增 `daily-contribution.tsx`——推漲/下跌 Top 3 卡片 + 貢獻度前 10 橫條（純 CSS 寬度，**不引入圖表套件**）+ 估算/實際/未歸因三數字 + disclaimer。紅漲綠跌。
4. **`web/app/etf/[etfId]/page.tsx`**：掛在 `PerformanceSummary`（line 94）之後、`HoldingsTable` 之前。
5. 對應 `*.test.ts(x)`。

## Non-goals

- 不做「相對 0050 差異度 / Active Share」——需要 0050 成分股權重，是**新增資料源**（元大 PCF 或 TWSE），另開一片。
- 不做多日期間的貢獻度累計（僅當日）。
- 不做海外行情整合。
- 不動 `etf_metrics`、`open_position`、pipeline、任何既有指標。
- 不改持股表、產業圓餅圖、異動時間軸、權重歷史圖。

## Context to Read

- `CLAUDE.md`（前端只 SELECT 的鐵則——本片 ⚖️#6 正是對它的裁決點）
- 主 spec §6（指標規則：所有報酬用還原價）、§7③（ETF 個別頁現行定義）、§1「海外持股範圍限定（v1）」
- `docs/superpowers/handoffs/2026-07-25-change-wall-grouping.md` 的 Non-goals（呈現層聚合的先例與界線）
- 既有程式：`web/lib/etf-detail.ts`（`buildHoldingRows` line 109、`round4` line 92）、`web/lib/etf-detail-data.ts`（snapshot 三日載入 line 266-290、etf select line 257）、`web/lib/today-overview-data.ts:223`（批次查價模式）、`web/components/etf-detail/performance-summary.tsx`（卡片版型）、`web/components/picking-disclosure.tsx`（免責註記樣式）
- `scraper/src/activeetf/metrics.py:110-150`（`load_adj_series`——證實 ETF 自身價格存於 `stock_price`，且缺價處理慣例）
- `scraper/migrations/001_schema.sql`（`stock_price` 有 `close` 與 `adj_close` 兩欄）

## Expected Files

`web/lib/etf-detail.ts`、`web/lib/etf-detail-data.ts`、`web/components/etf-detail/daily-contribution.tsx`、`web/app/etf/[etfId]/page.tsx` 及對應測試；若 ⚖️#0 裁決為「同 PR 改 spec」則加主 spec。

## Acceptance Criteria

- `npm test`、`npx tsc --noEmit`、`npm run lint`、`npm run build` 全過
- 單元測試涵蓋：t-1 權重取用正確（**不是 t**）、當日 EXIT 的持股有計入、當日 NEW 的持股被排除且計數正確、缺價跳過並計數、Σ contribution = `estimatedEtfReturnPct`、`unattributedPct = actual - estimated`
- global ETF 顯示「不適用（未整合海外行情）」而非空白或 0
- 紅漲綠跌正確；手機寬度不破版；深色模式正常
- **真資料 smoke 必做**：取 00981A 於最新交易日，手算至少 3 檔個股的 `w(t-1) × r(t)` 與畫面數字比對；並記錄「估算 vs 實際」差額，若絕對差 > 1.5pp 需在 PR body 說明原因（可能是快照缺股、現金部位大、或當日申贖）

## Risks

- **估算與實際的差額可能偏大**：00981A 最新快照權重加總僅 93.7%（我方解析 37 檔），約 6% 為現金/未揭露部位。差額本身不是 bug，但若持續 > 2pp 應開 issue 追查是否有持股解析遺漏（另見下一點）。
- **潛在資料完整性疑點（本片不修，但請在 PR body 記錄觀察）**：etfinfo 宣稱 00981A 揭露 51 檔持股，我方解析出 37 檔。重疊部分的股數完全一致（如 2330 = 11,840,000 股），顯示解析正確，差異可能在長尾小部位或對方將現金/期貨列入計數。建議由 Operator 另做一次性對帳，不要在本片擴張 scope。
- `adj_close` 對 ETF 自身可能有除息日缺值 → `actualEtfReturnPct` 為 null，此時「未歸因」一列顯示 `—`，不要湊數。
- 使用者可能把「貢獻度」誤讀為績效評價。disclaimer 必須寫明：以每日 PCF 快照結合成分股報酬估算，未計現金部位、折溢價、申贖與盤中交易，與實際淨值變動有差。

## Handoff Prompt

請以 Generator 身分依本 handoff 實作（Generator 可為 Claude 或 Codex，須與後續 Evaluator 不同 session）。**六項 ⚖️ 待裁決由 User 拍板後才開工**，尤其 ⚖️#1（期初權重）與 ⚖️#6（前端 vs pipeline）會改變實作形狀。完成後開 PR（base `main`），PR body 含變更摘要、驗證輸出、真資料 smoke 證據（含手算 3 檔對帳與估算/實際差額）、已知風險。不對正式 DB 執行語句。不得在未驗證時宣稱完成。
