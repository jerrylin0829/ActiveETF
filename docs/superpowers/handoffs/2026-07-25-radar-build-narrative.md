# Generator handoff — 新倉雷達改為「建倉脈絡」股票分組敘事

Planner：Claude Code ｜ 日期：2026-07-25 ｜ 目標分支前綴：`codex/`

**狀態：⚖️ 待裁決 6 項，User 拍板前不得開工。**

競品觀察來源：`https://www.etfinfo.tw/active/tracking`（2026-07-25 實地檢視）。對方把「哪些股票近期被主動 ETF 建倉」做成跨 ETF 的時序敘事，可讀性明顯優於我方現行平表；但對方**無基準相對報酬、無海外持股**，那兩項是我方要保留並突出的差異。

## Goal

把首頁「新倉追蹤雷達」從 `ETF × 股票` 的平表，改成**以股票為主體、跨 ETF 的建倉脈絡**：一檔股票一組，組內列出各檔 ETF 的建倉日與後續加/減碼時序，並保留每檔 ETF 既有的超額報酬。目的是讓「多位經理人正在同一檔股票上持續加碼」這件事一眼可見——目前這個訊號散落在 100+ 列平表中讀不出來。

## 設計決策清單

- ⚖️ **#0 spec 先行**：本片修改 spec §7① 已定義的雷達呈現規則。CLAUDE.md 要求「要改規則就先改 spec（並 commit）」。
  Planner 建議：比照 `2026-07-25-change-wall-grouping-design.md` 先由 Planner 寫一份 `2026-07-2X-radar-build-narrative-design.md`，User 核可後 Generator 才開工。**User 若選擇讓 Generator 在同一 PR 內順手改 spec，請明示。**
- ⚖️ **#1 分組主體改為股票**（現行為 `etfId × stockId` 一列）。Planner 建議：採用。組標題 = 股票 + 產業 + `N 檔 ETF / M 家投信建倉，後續加碼 K 筆`。
- ⚖️ **#2 視窗維持 20 個交易日**，不跟進對方的「近 30 天」。理由：spec §7① 明定「未滿 20 個交易日」，且 `open_position.holding_days < 20` 是既有快取語意，改天數會讓雷達與「長抱」徽章的邊界不一致。Planner 建議：維持 20。
- ⚖️ **#3 脈絡要不要顯示 TRIM**：對方只顯示「建倉 → 加碼」。只顯示加碼會產生選擇偏誤（看起來永遠在買）。Planner 建議：**TRIM 一併顯示**（綠色），這是對競品的誠實度優勢，也符合「錯資料比缺資料危險」的專案精神。EXIT 不會出現——該回合已結束，本來就不在雷達。
- ⚖️ **#4 四象限分類標籤**：`多 ETF 追買` / `單 ETF 追買` / `多 ETF 新進` / `單 ETF 新進`，作為可點擊的篩選頁籤（比照異動牆頁籤模式）。定義：
  - 多 ETF = 該股票在雷達視窗內有 **≥2 檔 ETF 的未平倉新倉回合**（沿用既有 `sharedEtfCount`）
  - 追買 = 該股票的任一回合在 `entry_date` 之後至少有一筆 ADD
  Planner 建議：採用，頁籤標籤帶檔數（`多 ETF 追買 32`）。
- ⚖️ **#5 金額估算**：`估算新進 = Σ(NEW shares_delta × 該事件日 close)`、`估算加碼 = Σ(ADD shares_delta × 該事件日 close)`，用 `formatYi` 顯示億。**用事件當日收盤價，不用最新收盤價**（對方用最新價，會讓金額隨行情漂移，失去「當時投入多少」的意義）。任一事件缺價 → 該欄位 `—`（沿用 `aggregateMoves` 的 `hasMissingClose` null 傳播模式）。海外股票無 `stock_price` → 一律 `—`。Planner 建議：採用。
- ⚖️ **#6 不做股票層級的彙總超額報酬**：各檔 ETF 的 `entry_date` 不同，跨 ETF 平均超額報酬沒有可辯護的定義。超額報酬只留在**每檔 ETF 那一列**（即現行 `open_position.excess_return_pct`，語意不變）。Planner 建議：採用；組標題不放任何報酬數字。

## Scope

1. **`web/lib/today-overview.ts`**
   - 新增 `buildRadarNarratives(...)`：吃現有 `RadarPosition[]` 再加上該視窗的 ADD/TRIM 事件，輸出以股票分組的結構。建議型別：
     ```ts
     export type RadarFollowUp = { tradeDate: string; changeType: "ADD" | "TRIM"; sharesDelta: number; close?: number | null };
     export type RadarEtfLeg = { etfId: string; etfName: string; issuer: string; entryDate: string; holdingTradingDays: number; excessReturnPct: number | null; excessReturnNote: RadarPosition["excessReturnNote"]; followUps: RadarFollowUp[] };
     export type RadarNarrative = { stockId: string; stockName: string; industry: string | null; etfCount: number; issuerCount: number; followUpCount: number; entryValueTwd: number | null; addValueTwd: number | null; segment: "multi_add" | "single_add" | "multi_new" | "single_new"; legs: RadarEtfLeg[] };
     ```
   - `legs` 依 `entryDate` 升冪、同日依 `etfId`；`followUps` 依 `tradeDate` 升冪。
   - 排序：`etfCount` desc → `followUpCount` desc → `entryValueTwd` desc（null 視為 0）→ `stockId`。
   - **`buildRadarPositions`（line 280）維持現狀不動**，新函式吃它的輸出——避免破壞既有測試與 `holdingDays < 20` 語意。
2. **`web/lib/today-overview-data.ts`**
   - `radarChangesResult`（line 348）的 `.in("change_type", ["NEW", "EXIT"])` 需擴充為含 `"ADD"`、`"TRIM"`，範圍仍為 `radarStartDate ~ selectedDate`。
   - 雷達視窗內的股票需補查收盤價：沿用既有 `fetchDailyCloses(stockIds, radarStartDate, selectedDate)`，與集體動向那次查詢合併或並行皆可。
   - 需帶入 `stock_info.industry`（現行 `fetchStockNames` 只取 `name`，line 202）——擴充為同時取 `industry`，或另開一個對應函式。
3. **`web/components/today-overview-dashboard.tsx`**（line 1-250）：雷達區塊改為分組卡片渲染 + 四象限頁籤（比照 `change-wall.tsx` 的頁籤/`查看更多` 模式），時間軸用純 CSS，**不引入圖表套件**。紅漲綠跌沿用既有 token。
4. 對應 `*.test.ts(x)`。

## Non-goals

- **不做技術面疊加**（對方的 `跌破MA20` / `站上MA20` / `跌破60日低`）——那需要新的價格衍生計算與 spec §6 新增定義，另開一片。
- 不改 `open_position` schema、不改 pipeline、不改超額報酬計算。
- 不改雷達的 20 交易日邊界與「長抱」徽章。
- 不做股票層級彙總報酬（見 ⚖️#6）。
- 不動異動牆、集體動向、資料缺口黃條。

## Context to Read

- `CLAUDE.md`（繁中、紅漲綠跌、前端只 SELECT）
- 主 spec `docs/superpowers/specs/2026-07-04-active-etf-tracker-design.md` §7①（雷達現行定義）、§6（超額報酬定義）
- `docs/superpowers/specs/2026-07-25-change-wall-grouping-design.md`（跨 ETF 彙總的量綱原則——本片金額欄位須遵守同一原則：跨 ETF 只能加金額，不能加權重百分比）
- `docs/superpowers/handoffs/2026-07-25-change-wall-grouping.md`（分組渲染與頁籤的既有先例）
- 既有程式：`web/lib/today-overview.ts`（`buildRadarPositions` line 280、`groupChangeWall` line 153、`aggregateMoves` line 227 的 null 傳播）、`web/lib/today-overview-data.ts`（`radarChangesResult` line 348、`fetchStockNames` line 202、`fetchDailyCloses` line 223）、`web/components/change-wall.tsx`

## Expected Files

`web/lib/today-overview.ts`、`web/lib/today-overview-data.ts`、`web/components/today-overview-dashboard.tsx`（或新增 `web/components/radar-narrative.tsx`）及對應測試；若 ⚖️#0 裁決為「同 PR 改 spec」則加 `docs/superpowers/specs/2026-07-04-active-etf-tracker-design.md`。

## Acceptance Criteria

- `npm test`、`npx tsc --noEmit`、`npm run lint`、`npm run build` 全過
- 分組正確：同一股票的多檔 ETF 收在同一組；`etfCount`、`issuerCount`、`followUpCount` 與底層事件一致
- 四象限頁籤：四類檔數加總 = 全部檔數，切換後列表正確
- 脈絡時序：每檔 ETF 顯示 `建倉日 → 後續 ADD/TRIM 日`，升冪排列，TRIM 綠色 ADD 紅色
- 金額：用**事件當日**收盤價；缺價或海外顯示 `—`，不顯示 0
- 超額報酬仍逐 ETF 顯示、`不適用`／`—` 兩種註記語意不變（`today-overview.ts:52` 的註解）
- 手機寬度不破版、深色模式正常
- 真資料 smoke：任選一檔多 ETF 追買的股票，人工比對其脈絡與 `holding_change` 原始列一致

## Risks

- `radarChangesResult` 加入 ADD/TRIM 後資料量顯著上升（20 交易日 × 全部 ETF 的加減碼）。`fetchPaged` 已處理分頁，但需確認首頁 TTFB 未明顯劣化；若過慢，改為只查雷達視窗內**有未平倉新倉回合**的 `(etf_id, stock_id)` 組合。
- `stock_info.industry` 對海外股票多為空 → 顯示 `未分類`（沿用 `etf-detail.ts:149` 既有 fallback），不要隱藏該組。
- 四象限的「追買」定義依賴 ADD 事件，而 ADD 事件受主 spec 鐵則 3（權重變化 ≥ 0.05pp）過濾——我方的追買筆數會**系統性少於對方**（對方純看張數差、不濾申贖）。這是預期行為，不是 bug；請在區塊說明文字點明「已濾除申贖造成的等比例變動」。

## Handoff Prompt

請以 Generator 身分依本 handoff 實作（Generator 可為 Claude 或 Codex，須與後續 Evaluator 不同 session）。**六項 ⚖️ 待裁決由 User 拍板後才開工。**完成後開 PR（base `main`），PR body 含變更摘要、驗證輸出、真資料 smoke 證據（含一檔股票的脈絡對帳）、已知風險與後續工作。不對正式 DB 執行語句。不得在未驗證時宣稱完成。
