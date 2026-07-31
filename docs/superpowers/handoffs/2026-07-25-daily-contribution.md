# Generator handoff — ETF 個別頁「當日成分股貢獻度」歸因

Planner：Claude Code ｜ 日期：2026-07-25（2026-07-31 修訂）｜ 目標分支前綴：`codex/`

**狀態：已核可，待 spec 落地後可開工。** 2026-07-31 User 裁決：六項全數採 Planner 建議（#6 依主 spec §3 新增的「呈現層聚合」界線定案）。#4 補充「註記須列出代號」；#5 採甲案並改名「差異」，**若實際版面過於複雜，退回只顯示估算（乙案）**——此退場路徑由 User 於驗收時決定，Generator 先做甲案。

下方 ⚖️ 標記保留原始論證脈絡，全部視為已裁決，Generator 照做勿重新設計。

競品觀察來源：`https://www.etfinfo.tw/etf/00981A`（2026-07-25 實地檢視）。對方在 ETF 頁提供「今日推漲/下跌 Top 3 + 貢獻度排行」，資料需求我方 100% 具備卻未做，是目前投報率最高的缺口。**但對方的算法用當日權重（見 ⚖️#1），我方要用期初權重，數字會不同且更正確。**

## Goal

在 ETF 個別頁（spec §7③）新增「當日成分股貢獻度」區塊：以**前一交易日權重 × 當日還原價報酬**歸因，列出推漲/下跌 Top 3 與貢獻度排行前 10，並顯示「估算／實際／差異」三個 ETF 當日漲跌供對照。

注意「實際」為市價報酬而非 NAV，差異項含折溢價變動——**不可宣稱為資料品質自檢**，理由見 ⚖️#5。

## 設計決策清單

- ⚖️ **#0 spec 先行**：貢獻度是 spec §6 未定義的**新指標**，須寫入 §6 並在 §7③ 列出。CLAUDE.md：「要改規則就先改 spec（並 commit）」。
  Planner 建議：由 Planner 先補 §6 一小節（公式 + 基準 + 適用範圍）與 §7③ 一行，commit 後 Generator 開工。**User 若選擇同 PR 內改，請明示。**
- ⚖️ **#1 權重基準用「前一交易日」**（`contribution_i = w_i(t-1) × r_i(t)`）。對方用當日權重 `w_i(t) × r_i(t)`——那是錯的：`w_i(t)` 已內含當日漲跌，用它會系統性高估上漲股的貢獻。標準績效歸因一律用期初權重。
  Planner 建議：**採用 t-1 權重**。此為與競品的實質正確性差異，值得在說明文字點出。
- ⚖️ **#2 報酬用 `adj_close`**（還原價），不用 `close`。理由：主 spec §6 鐵則「所有報酬用還原價」；成分股除息日的淨值缺口由基金收到的現金抵銷，用還原價才是對淨值變動的正確歸因。
  Planner 建議：採用 `adj_close`；**個股「當日漲跌」欄位也一併用 `adj_close` 算**，讓「漲跌 × 權重 = 貢獻」在畫面上自洽（對方畫面上這三個數字用不同基礎，讀者無法驗算）。除息日差異寫進 disclaimer。
- ⚖️ **#3 只做 `universe = 'tw'` 的 ETF**。global ETF（00402A、00983A、00986A、00988A、00989A、00990A、00997A、00998A）的 `stock_price` 無海外個股行情——主 spec §1「海外持股範圍限定（v1）」已明定不整合海外行情。
  Planner 建議：global ETF 該區塊顯示「不適用（未整合海外行情）」，**不隱藏區塊**（符合「缺資料要可見」）。
- ⚖️ **#4 當日新進持股的貢獻值為 0（這是正確值，不是缺值），呈現上不列入貢獻度排行**。
  推理：`w(t-1) = 0` 不是「資料缺漏」——該股在 t 日開盤時基金根本沒持有，`close(t-1) → close(t)` 這段價格變動不影響基金淨值。基金確實在盤中某時點買進並持有到收盤，但 PCF 是每日收盤快照，**買進時點與成交價無從得知**，那段盤中損益本來就不可觀測。所以 0 是模型下的正確答案。**真正會造數字的是拿 `w(t)` 去乘當日報酬**——那等於把一整天的漲跌歸因給一個當天才建立的部位。
  既然是 0，「排除」與「計 0」在數字上等價，差別純粹在畫面：**從貢獻度排行清單不列**（避免排行被一串 `0.00%` 塞滿）。

  **「不列」的範圍僅限貢獻度排行那份清單。** 該股在頁面其他區塊照常出現——當前持股表（含 `NEW` 徽章）、異動時間軸、產業圓餅圖權重皆不受影響。

  ✅ **User 補充裁決（2026-07-31）：註記須列出代號，不可只給檔數。** 格式如：
  > 本日新進 3 檔未計入歸因：4979 華星光、2408 南亞科、4958 臻鼎-KY
  > （開盤時未持有，當日盤中損益無法自 PCF 快照推算）

  **重要後果**（須寫進 disclaimer）：當日建倉部位的盤中損益會**系統性落進 #5 的「差異」項**。大量建倉的日子，估算與實際的差會變大，這是預期行為不是 bug。
- ⚖️ **#4b 當日 EXIT 的持股應計入**（它在 t-1 有權重、當日有報酬）。Generator 需從 **t-1 快照**而非 t 快照展開歸因清單。同樣有盤中賣出時點不可知的誤差，方向與 #4 相反。
- ⚖️ **#5 顯示「估算」「實際」「差異」三個 ETF 當日漲跌**（甲案）。`估算 = Σ contribution`；`實際` 取 `stock_price` 中以 `etf_id` 為 key 的 `adj_close` 當日報酬（`metrics.py:115` 的 `load_adj_series` 證實 ETF 自身價格就存在同一張表）；`差異 = 實際 − 估算`。

  ⚠️ **概念上必須講清楚的一件事（Planner 於裁決過程中修正）：我方的「實際」是市價報酬，不是 NAV。**

  貢獻度歸因解釋的是**淨值變動**（權重 × 個股報酬）。但 `stock_price` 存的是該 ETF 的**市場成交價**，我方**沒有 NAV 資料**（schema 只有 `close` / `adj_close`）。兩者相差一個折溢價變動。因此：

  ```
  差異 = 現金部位 + 盤中交易 + 申贖 + 折溢價變動 + 未揭露持股
                                        ↑ 與資料品質無關，本質上不可能被持股資料解釋
  ```

  **所以這一項不得標為「未歸因」，也不得宣稱為資料品質指標。** 前者暗示我方沒解釋好，但折溢價在定義上就解釋不了。

  ✅ **User 裁決（2026-07-31）：採甲案，附三項條件**
  1. **名稱用「差異」**，不得用「未歸因」
  2. **明列成因**：`差異 −0.42%（含現金部位、折溢價變動、盤中交易與申贖）`
  3. **不設異常門檻**——先觀察一至兩週實際分布再議

  採甲的另一個理由：ETF 個別頁**目前完全沒有顯示當日漲跌**（只有 1/3/6 個月與上市以來），加「實際」同時補上這個缺口。

  **退場路徑**：若三個數字實際做出來版面過於複雜，退回乙案（只顯示估算）。由 User 於驗收時決定，Generator 先做甲案。

  **未來**：若日後引入 NAV 資料源（做折溢價功能時會需要），「實際」可換成淨值報酬，差異項才會真正接近資料品質指標。**不在本片範圍。**
- ⚖️ **#6 算在前端 `lib/` 純函式，不新增快取表**。CLAUDE.md 鐵則為「計算一律在寫入時做」，但既有先例 `today-overview.ts:227 aggregateMoves` 已在前端做「股數 × 收盤價」聚合，且 `2026-07-25-change-wall-grouping.md` 的 Non-goals 明文將此類歸為「呈現層聚合」。本片規模同級（單一 ETF、≤ 60 列、資料已在同一次 SELECT 中）。
  ✅ **User 裁決（2026-07-31）：前端純函式。** 判準已寫入主 spec §3「呈現層聚合」（結構性質為判準、資料量僅為效能逃生門），本片依該界線辦理。

## Scope

1. **`web/lib/etf-detail.ts`**：新增純函式
   ```ts
   export type ContributionRow = { stockId: string; stockName: string; prevWeightPct: number; returnPct: number; contributionPct: number };
   export type NewHolding = { stockId: string; stockName: string };
   export type DailyContribution = { rows: ContributionRow[]; estimatedEtfReturnPct: number; actualEtfReturnPct: number | null; differencePct: number | null; newHoldings: NewHolding[]; missingPriceCount: number; applicable: boolean };
   export function buildDailyContribution(...): DailyContribution
   ```
   - 歸因清單以 **`previous` 快照**（t-1）展開，非 `current`
   - `returnPct = adj_close(t) / adj_close(t-1) - 1`；任一端缺價 → 該股跳過並計入 `missingPriceCount`
   - `rows` 依 `contributionPct` 降冪
   - `newHoldings` 為當日新進（t-1 無權重）的代號與名稱清單，供註記列出（⚖️#4）；**不是計數**
   - `differencePct = actualEtfReturnPct − estimatedEtfReturnPct`；`actual` 為 null 時亦為 null
2. **`web/lib/etf-detail-data.ts`**：`snapshotResult`（line 279）已同時載入 `latestDate` / `previousDate` / `twentyDayDate` 三份快照，**t-1 權重免費取得**。需新增：查 `stock_price` 取 `(stockIds ∪ {etfId}) × {previousDate, latestDate}` 的 `adj_close`（沿用 `web/lib/today-overview-data.ts:223 fetchDailyCloses` 的分批查詢模式，欄位改 `adj_close`）。ETF 的 `universe` 需從 `etf` 表一併 select（line 257 現只取 `etf_id, name, issuer, listed_date`）。
3. **`web/components/etf-detail/`**：新增 `daily-contribution.tsx`——推漲/下跌 Top 3 卡片 + 貢獻度前 10 橫條（純 CSS 寬度，**不引入圖表套件**）+ **估算／實際／差異**三數字（差異須帶成因說明，見 ⚖️#5）+ 新進未計入註記（列代號，見 ⚖️#4）+ disclaimer。紅漲綠跌。
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
- 單元測試涵蓋：t-1 權重取用正確（**不是 t**）、當日 EXIT 的持股有計入、當日 NEW 的持股貢獻為 0 且不出現在排行、`newHoldings` 列出正確代號、缺價跳過並計數、Σ contribution = `estimatedEtfReturnPct`、`differencePct = actual − estimated`、`actual` 為 null 時 `differencePct` 亦為 null
- 「差異」的顯示文字必須含成因說明；**測試須斷言頁面不出現「未歸因」字樣**
- global ETF 顯示「不適用（未整合海外行情）」而非空白或 0
- 紅漲綠跌正確；手機寬度不破版；深色模式正常
- **真資料 smoke 必做**：取 00981A 於最新交易日，手算至少 3 檔個股的 `w(t-1) × r(t)` 與畫面數字比對；並記錄「估算 vs 實際」差額與當日新進/出清檔數，於 PR body 呈報（供日後判定合理區間，本片不設門檻）

## Risks

- **估算與實際的差額本來就會存在**：00981A 於 2026-07-29 快照為 51 檔、權重加總約 88.7%，其餘為現金與其他部位。差額不是 bug。**不要為差額設一個武斷的門檻去追 bug**——先觀察一至兩週的實際分布，再決定合理區間。
- `adj_close` 對 ETF 自身可能有除息日缺值 → `actualEtfReturnPct` 為 null，此時「實際」與「差異」皆顯示 `—`，不要湊數。
- 使用者可能把「貢獻度」誤讀為績效評價。disclaimer 必須寫明：以每日 PCF 快照結合成分股報酬估算；「實際」為市價報酬（非 NAV），差異項含現金部位、折溢價變動、盤中交易與申贖；**當日新進與出清部位的盤中損益不可觀測，一併落進差異**。

## Handoff Prompt

請以 Generator 身分依本 handoff 實作（Generator 可為 Claude 或 Codex，須與後續 Evaluator 不同 session）。**六項設計決策已於 2026-07-31 由 User 全數核可，照做勿重新設計；待 spec commit 落地後開工。**特別注意 ⚖️#1（期初權重，非當日權重）與 ⚖️#5（「差異」不得標為「未歸因」）。完成後開 PR（base `main`），PR body 含變更摘要、驗證輸出、真資料 smoke 證據（含手算 3 檔對帳與估算/實際差額）、已知風險。不對正式 DB 執行語句。不得在未驗證時宣稱完成。
