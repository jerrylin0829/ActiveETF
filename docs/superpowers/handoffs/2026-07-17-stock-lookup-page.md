# Generator handoff — Dashboard 第五片：個股反查頁

Planner：Claude Code ｜ 日期：2026-07-17 ｜ 依賴：第四片（ETF 個別頁）合併後再開工（共用連結與元件模式）

**狀態：已核可（User 2026-07-17 授權階段 0–4 全量執行）。**

## Goal

完成 spec §7 ④ 個股反查頁 `/stock/[stockId]`：從股票視角回答「誰持有、誰在加誰在減、全體主動 ETF 對它的合計權重怎麼走」。交集表與今日總覽的股票名稱從此可點。

## Scope

1. **路由** `web/app/stock/[stockId]/page.tsx`：server component；`stock_id` 從未出現在任何快照 → 404
2. **頁首**：代號、名稱、產業（`stock_info`；查無則顯示原代號、產業「未分類」）、最新日被幾檔 ETF 持有（`cross_holdings_daily` 最新列）
3. **誰持有**（最新交易日）：每列一檔 ETF——ETF 代號/名稱（連 `/etf/[etfId]`）、權重、張數、當日異動徽章（有 `holding_change` 者）、持有天數與長抱（join `open_position`，比照第四片規則，無資料顯示「—」）；預設權重降冪
4. **全體合計權重走勢**：`cross_holdings_daily` 該股全期序列，畫兩條線——合計權重（%）與涵蓋檔數（右軸整數）；Recharts、時間範圍切換沿用輪動頁模式（顯示範圍與資料計算解耦）
5. **事件歷史**：該股全部 `holding_change` 依日期新到舊，顯示 ETF、事件類型（紅漲綠跌徽章）、股數與權重變化；最近 30 個交易日
6. **入口連結**：交集表主表與展開明細的股票名稱、今日總覽異動牆與雷達的股票名稱 → `/stock/[stockId]`
7. 數字格式用 `lib/format.ts`；手機 375px 可用；資料缺口黃條沿用既有元件

## Non-goals

- 新資料表或 pipeline 變更（資料全現成：`cross_holdings_daily` 是本頁的走勢資料源——第三片交集表已把這頁變便宜）
- 個股股價線圖（本站不是看盤軟體；只呈現持股視角）
- 同股多代號正規化（`2330` 與 `2330 TT` 視為不同代號，各自成頁——已知限制，記入頁尾註記與主 spec 未來擴充）
- 前端計算報酬或指標

## Context to Read

- `CLAUDE.md`、主 spec §7 ④
- 第四片產出的 `web/lib/etf-detail*.ts` 與 `web/components/etf-detail/`（連結模式、持有天數顯示——重用勿重造）
- `web/lib/cross-holdings-data.ts`（`cross_holdings_daily` 查詢模式）
- `web/components/rotation-dashboard.tsx`（雙軸折線與範圍切換）

## Expected Files

- `web/app/stock/[stockId]/page.tsx`
- `web/lib/stock-lookup.ts` + `web/lib/stock-lookup-data.ts`
- `web/components/stock-lookup/`（持有表、權重走勢圖、事件歷史）
- 對應 vitest 測試；交集表/今日總覽加連結的既有元件與測試更新

## Acceptance Criteria

- `npm test`、`npx tsc --noEmit`、`npm run lint`、`npm run build` 全過
- 走勢圖與交集表同日數字一致（同一資料源，抽查一日）
- 誰持有表與 `/cross` 展開明細一致（抽查一檔股票）
- 未知代號 404；海外代號頁面可開（產業未分類；有 `open_position` 時保留持有天數，個股報酬仍不適用）
- 真資料 smoke：抽 2330 與一檔海外代號各檢查三個區塊

## Risks

- `cross_holdings_daily` 歷史僅數日，走勢圖短期內很短——功能正確即可
- 事件歷史對高頻異動股可能較長，已限最近 30 個交易日

## Handoff Prompt

請以 Generator 身分依本 handoff 實作，TDD、每邏輯單位一 commit（`type: 中文描述`）。完成後回報，由獨立 Evaluator 審查後開 PR。不得在未驗證時宣稱完成。
