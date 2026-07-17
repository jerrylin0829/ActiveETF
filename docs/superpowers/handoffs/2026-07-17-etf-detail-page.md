# Generator handoff — Dashboard 第四片：ETF 個別頁

Planner：Claude Code ｜ 日期：2026-07-17 ｜ 依賴：第三片（open_position 表）先合併

**狀態：已核可（User 2026-07-17 授權階段 0–4 全量執行）。**

## Goal

完成 spec §7 ③ ETF 個別頁 `/etf/[etfId]`：一檔 ETF 的完整視角——績效卡、當前持股表（含權重變化與持有天數）、產業圓餅圖、異動時間軸、單一持股權重歷史折線。排行榜、交集表明細、今日總覽的 ETF 名稱從此有地方可點。

## Scope

1. **路由** `web/app/etf/[etfId]/page.tsx`：server component，`etf_id` 不存在時 404（`notFound()`）
2. **績效卡**：`etf_metrics` 最新一列——各期報酬 vs 0050、兩勝率（含樣本數、樣本 <10 淡化標「樣本不足」，比照排行榜既有元件；能重用 `web/lib/rankings.ts` 的邏輯就重用）、中位數持有天數、週換手率
3. **當前持股表**（最新快照，每列一檔持股）：
   - 欄：代號/名稱（`stock_info`，查無代號顯示原代號）、權重、vs 前日權重變化、vs 20 交易日前權重變化、張數、持有天數、長抱徽章
   - 權重變化 = 兩次快照相減（比照輪動頁 5/20 日變化的既有前端模式）；「前日」「20 交易日前」都用該 ETF `holdings_snapshot` 的 distinct trade_date 序列回推；當日新進（前日無此股）變化欄顯示「新進」
   - 持有天數與長抱：join `open_position`（`holding_days`；`>= 20` 顯示「長抱」徽章）；`open_position` 查無的持股（資料起始日前存量）持有天數顯示「—」
   - 預設權重降冪，數值欄可排序
4. **產業圓餅圖**（Recharts PieChart）：當前快照依 `stock_info.industry` 加總權重，空產業歸「未分類」；配色沿用輪動頁 palette；hover 顯示產業與權重
5. **異動時間軸**：該 ETF `holding_change` 依日期新到舊分組，每筆顯示 NEW/ADD/TRIM/EXIT（紅漲綠跌徽章，沿用 today-overview 的 `badgeTone` 慣例）、股票、股數與權重變化；先做最近 30 個交易日、「載入更多」不做（YAGNI，寫進 Non-goals）
6. **單一持股權重歷史折線**：點持股表任一列 → 該股在此 ETF 的 `holdings_snapshot` 權重時間序列（Recharts LineChart，全期）；EXIT 期間無資料自然斷線（不 connectNulls，代表未持有）
7. **入口連結**：排行榜 ETF 名稱、交集表展開明細的 ETF 名稱、今日總覽異動牆的 ETF 名稱 → `/etf/[etfId]`
8. 數字格式一律用 `web/lib/format.ts`（權重 `12.34%`、變化 `+1.25%`、張數千分位）；手機 375px 可用

## Non-goals

- 任何新資料表或 pipeline 變更（本片純前端，資料全部現成：`etf_metrics`、`holdings_snapshot`、`holding_change`、`stock_info`、`open_position`）
- 前端計算報酬或指標（權重相減、COUNT/SUM 聚合屬呈現層查詢，比照今日總覽與輪動頁既有先例）
- 異動時間軸分頁/無限捲動
- 個股反查頁（第五片）；site-nav 不加項目（個別頁由連結進入）

## Context to Read

- `CLAUDE.md`、主 spec §6 與 §7 ③
- `docs/superpowers/handoffs/2026-07-17-radar-excess-return.md`（`open_position` schema 與語意）
- `web/lib/rankings.ts` + `web/components/rankings-table.tsx`（勝率顯示、樣本不足淡化——重用勿重造）
- `web/components/today-overview-dashboard.tsx`（`badgeTone`/`changeTone` 紅漲綠跌慣例）
- `web/components/rotation-dashboard.tsx`（Recharts 用法、palette、範圍切換模式）
- `web/lib/cross-holdings-data.ts`（分頁查詢 `fetchAllByDate` 模式）

## Expected Files

- `web/app/etf/[etfId]/page.tsx`
- `web/lib/etf-detail.ts`（純邏輯：快照差分、日期回推、圓餅聚合）+ `web/lib/etf-detail-data.ts`（查詢）
- `web/components/etf-detail/`（績效卡、持股表、圓餅、時間軸、權重折線，檔案依責任拆分）
- 對應 vitest 測試（純邏輯全覆蓋；元件測互動與格式）

## Acceptance Criteria

- `npm test`、`npx tsc --noEmit`、`npm run lint`、`npm run build` 全過
- 快照差分正確：前日新進顯示「新進」、EXIT 不出現在當前持股表
- 持有天數與長抱徽章與 `open_position` 一致；存量持股顯示「—」不亂算
- 折線圖點選切換正確；未持有期間斷線
- 無效 etf_id → 404；資料缺口黃條沿用既有元件
- 真資料 smoke：對照 00981A 的持股表與投信官網 PCF 抽查 3 檔權重

## Risks

- 20 交易日前的快照可能因資料僅累積數週而不存在——變化欄顯示「—」，不得用更早的快照冒充
- `open_position` 依賴第三片 merge；本片分支應以第三片分支為 base（stacked PR）

## Handoff Prompt

請以 Generator 身分依本 handoff 實作，TDD、每邏輯單位一 commit（`type: 中文描述`）。完成後回報，由獨立 Evaluator 審查後開 PR。不得在未驗證時宣稱完成。
