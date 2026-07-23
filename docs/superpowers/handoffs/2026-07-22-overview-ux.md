# Generator handoff — 今日總覽 UX 優化

Planner：Claude Code ｜ 日期：2026-07-22 ｜ 目標分支前綴：`codex/`

## 設計決策清單（全部已裁決，照做勿重新設計）

- ✅ 集體動向期間：`當日/本週/上週/本月/上月`，按鈕只顯示名稱，日期由上方單一「資料更新至 YYYY-MM-DD」承載；本週/上週=週一～週五
- ✅ 期間切換不跳頁：`<Link scroll={false}>`，保留 server 查詢
- ✅ 海外代號去重複：`formatStockLabel(id, name)`，name 為空或等於 id 時只顯示 id 一次；全站套用
- ✅ 市場判別：`stockMarket(id)`，結尾「空格+兩大寫字母」為 overseas，否則 tw
- ✅ pp → %：`formatWeightDelta` 改 `+0.05%`（兩位小數）
- ✅ 異動牆：客戶端內頁籤（建倉出清 NEW+EXIT／加減碼 ADD+TRIM）+ 市場切換（台股／海外）+ 每組前 5 筆依權重幅度降冪、其餘「查看更多」+ 說明文字 + N/E/A/T 圖例
- ✅「即時」僅指前端互動反應，資料仍是每日排程的 PCF 當批快照，不做即時資料

## Goal

依已核可 spec 與 plan 完成今日總覽（首頁）UX 優化。純前端、不動 DB/pipeline/指標。

## Scope

嚴格照 plan 的 9 個 task 逐一 TDD 實作，每個 task 一或多個 commit：
`docs/superpowers/plans/2026-07-22-overview-ux.md`（每步含完整程式碼與預期輸出）。

## Non-goals

- 任何 DB schema、pipeline、指標計算變更
- 海外股中文名整合（維持 holdings-only，代號去重複即可）
- 集體動向「本週 vs 上週」並列 delta（本次只做可切換檢視）
- 對正式 DB 執行任何語句（本片純前端，也不需要）

## Context to Read（開工前）

- `CLAUDE.md`（紅漲綠跌、繁中、前端只 SELECT）
- `docs/superpowers/process/agent-workflow.md`（正式版流程、你的角色約束）
- **設計事實來源**：`docs/superpowers/specs/2026-07-22-overview-ux-design.md`
- **實作步驟**：`docs/superpowers/plans/2026-07-22-overview-ux.md`
- 既有程式：`web/lib/format.ts`、`web/lib/today-overview.ts`、`web/lib/today-overview-data.ts`、`web/components/today-overview-dashboard.tsx`（plan 已引用確切行號與現有寫法）

## Expected Files

見 plan 各 task 的 Files 區塊。核心：`web/lib/format.ts`、`web/lib/today-overview.ts`、`web/lib/today-overview-data.ts`、`web/components/today-overview-dashboard.tsx`、新增 `web/components/change-wall.tsx`，以及 etf-detail / cross-holdings / stock-lookup 顯示點的 `formatStockLabel` 套用；對應 `*.test.ts(x)`。

## Acceptance Criteria

- `npm test`、`npx tsc --noEmit`、`npm run lint`、`npm run build` 全過
- plan Task 9 Step 2 的真資料 smoke 六項逐條符合（更新時間、期間切換不跳頁且上週/上月有資料、異動牆頁籤/市場/查看更多、海外去重複、pp 全改 %、375px 不溢出）

## Required Verification

- 各純函式與元件測試依 plan 撰寫並通過
- 真資料 smoke：本機 dev 對正式 Supabase，挑一個有海外持股的交易日；截圖或描述異動牆三種切換、海外 `MRVL US` 不重複、權重 `+0.05%` 格式
- 無 DB 寫入，故不需整合測試綠燈證據

## Risks

- **異動牆抽成 client 元件**（Task 7）：dashboard 目前是 server component，`ChangeWall` 需 `"use client"`；移除內嵌 `ChangeWall` 時注意別誤刪雷達仍用的 `formatSignedPct` import。
- **`formatStockLabel` 全站套用**（Task 6）：用 plan 的 grep 定位，只改「代號+名稱並排」處；ETF 名稱（etfId+etfName）不套此規則。
- **`OverviewRange` 擴充 5 值**：`date-selector.tsx` 的 hidden `range` input 傳字串即可，無需改型別以外的邏輯。

## Handoff Prompt

請以 Generator 身分依本 handoff 與 plan 逐 task 實作（Generator 可為 Codex，須與後續 Evaluator 不同 session）。完成後開 PR（base `main`），PR body 含變更摘要、驗證指令與輸出、真資料 smoke 證據（含海外代號去重複與 pp→% 畫面）、已知風險。不對正式 DB 執行語句；不得在未驗證時宣稱完成。
