# Generator handoff — Dashboard 第二片：首頁今日總覽

Planner：Claude Code ｜ 日期：2026-07-15 ｜ 目標分支前綴：`codex/`

## Goal

完成 Dashboard 第二個頁面「今日總覽」（spec §7 ①）並設為首頁。pipeline 已連續產出真資料（`holding_change` 133+ 筆、28 檔全數入庫），這頁是整個產品的核心視角：今天誰買了什麼、誰出清了什麼、哪些股票被集體加碼。排行榜（第一片）已在 `/rankings`。

## Scope

1. **首頁路由調整**：`app/page.tsx` 改為今日總覽；排行榜保留在 `/rankings`（若第一片把首頁也設成排行榜，改為 redirect 或直接替換）。加簡單導覽（兩頁互連）。
2. **日期選擇器**：預設最新有資料的交易日（`holding_change` 的 max trade_date），可切換到任何有資料的日期。
3. **異動牆**：選定日期的 `holding_change`，NEW/EXIT 置頂、其次 ADD/TRIM；每筆顯示 ETF（join `etf` 取名稱）、股票（join `stock_info` 取名稱，查無代號則顯示原代號——海外持倉會這樣）、股數變化、權重變化。漲跌方向紅漲綠跌（加碼紅、減碼綠）。
4. **集體動向**：時間切換 `當日/本週/本月`（預設當日），被最多檔 ETF 加碼（NEW+ADD）/減碼（TRIM+EXIT）Top 10；排序先 ETF 檔數、後合計權重增量絕對值。聚合用 SQL 做即可（COUNT/SUM 是查詢不是指標計算）。
5. **新倉追蹤雷達（本片降規格）**：列出「NEW 事件後尚未 EXIT、且未滿 20 個交易日」的部位，顯示 ETF、股票、進場日、**持有交易日數**、「N 檔 ETF 近期同步建倉」共同訊號（同一股票被 ≥2 檔在雷達期內建倉時標示）。**「買進至今超額報酬」欄位顯示「待上線」佔位**——此數字需 pipeline 端計算快取，本片不做、更不得在前端算。
   - 交易日曆判定：用 `holdings_snapshot` 的 distinct `trade_date` 當交易日序列即可。
6. **資料缺口黃條**：沿用第一片元件；選定日期若有 ETF scrape 失敗（查 `scrape_log` status='fail'），黃條列出缺哪幾檔。
7. 手機 375px 可用；全站文案繁體中文。

## Non-goals

- 新倉雷達的超額報酬計算與 ±10% 標色——需先有 pipeline 片新增衍生表，屬第三片。
- 「長抱」徽章與畢業動畫（滿 20 日移出雷達本片只需「不顯示」即可）。
- 任何 pipeline / scraper / DB schema 變更；例外：為避免首頁查詢量隨歷史無上限成長，可新增唯讀 distinct date view/RPC，且不得改變既有資料寫入流程或表格語意。
- 前端計算任何報酬或指標（鐵則：只 SELECT，聚合限 COUNT/SUM/GROUP BY）。
- ETF 個別頁、個股反查頁。
- 深色模式 toggle。

## Context to Read

- `CLAUDE.md`（資料原則、紅漲綠跌、繁中）
- `docs/superpowers/specs/2026-07-04-active-etf-tracker-design.md` §5（異動事件語意）、§7 ①（本頁需求原文）
- `scraper/migrations/001_schema.sql`（`holding_change`、`scrape_log`、`stock_info` 欄位）
- `web/`（第一片的既有結構、Supabase client、黃條元件——重用，勿重造）
- `docs/superpowers/process/pr-review-checklist.md`

## Expected Files

- `web/app/page.tsx`（今日總覽）、`web/app/rankings/`（如需調整導覽）
- `web/components/`：異動牆、集體動向、新倉雷達、日期選擇器元件
- `web/lib/`：新增查詢函式（沿用既有 supabase client）
- 對應的 vitest 測試

## Acceptance Criteria

- `npm run build` / `lint` / `test` 通過。
- 異動牆：NEW/EXIT 在 ADD/TRIM 之前；紅漲綠跌正確；海外代號無名稱時不炸。
- 集體動向：三個時間範圍可切換，排序規則正確（先檔數後權重增量）。
- 雷達：只列未平倉且 <20 交易日的 NEW 部位；持有天數用交易日不是日曆日；共同訊號正確；超額報酬欄為「待上線」佔位。
- 日期切換後三個區塊同步更新。
- 選定日期有 scrape 失敗時黃條可見（可用歷史上 00987A 失敗的 07-13/07-14 驗證）。
- 前端無任何價格/報酬計算。

## Required Verification

- `npm run build`、`npm run lint`、`npm run test`：貼輸出。
- **真資料 smoke**（現在有真資料，不需 seed）：連正式 Supabase，切到最新交易日與 07-14（含 00987A 失敗記錄的日子），截圖或描述三區塊與黃條實際渲染結果。
- 375px 寬度 smoke。

## Risks

- **樣本還很淺**：`holding_change` 目前只有 2 個交易日的事件，「本週/本月」切換的結果會跟「當日」差不多——功能要做對，但 demo 效果有限，屬預期。
- **雷達的 20 交易日窗**：資料才累積 2 天，現在所有 NEW 部位都會在雷達內，「滿 20 日移出」的行為短期無法用真資料驗證——用單元測試驗邏輯即可。
- **00987A 缺口**：07-13/07-14 該檔持股是永久缺口（spec §9），異動牆在這兩天不會有它的事件；07-15 起它的首日快照會產生一批 NEW 事件（首日全持股視為 NEW 的行為請先確認 diff 邏輯實況——若首日無 prev snapshot 不產事件，雷達也不會有它，如實呈現即可，不要特判）。
- **第一片路由現況**：`/` 與 `/rankings` 目前皆為排行榜，本片要把 `/` 換成今日總覽，注意別破壞第一片的測試。

## Handoff Prompt

請以 Codex Generator 身分依本 handoff 實作。完成後開 PR（base 為 `main`），PR body 請包含變更摘要、驗證指令與輸出、真資料 smoke 證據（含 07-14 黃條驗證）、已知風險與後續工作。不得在未驗證時宣稱完成；前端嚴禁計算報酬——雷達的超額報酬欄位是「待上線」佔位，不是要你想辦法算出來。
