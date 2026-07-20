# Generator handoff — bench_0050_inception 補欄

Planner：Claude Code ｜ 日期：2026-07-19 ｜ 目標分支前綴：`codex/`

## 設計決策清單

- ✅ 已裁決：`etf_metrics` 新增 `bench_0050_inception numeric` 欄，由 pipeline 計算並寫入
- ✅ 已裁決：計算重用既有函式 `inception_return()`，套用在 `compute_all()` 已載入的 `bench_0050` series，不新增第二套報酬計算
- ✅ 已裁決：backfill 對既有 `etf_metrics` 全表補算（欄位可從既有快取的 `stock_price` 重算，符合資料原則 1）

## Goal

`etf_metrics` 缺「上市以來」同期 0050 基準（`bench_0050_1m/3m/6m/1y` 都有，唯獨 inception 沒有），導致 ETF 個別頁與排行榜的「上市以來」列顯示「無同期基準」——這是 spec §6「旁列同期基準」規則的資料缺口（已在 spec 加註記，見 2026-07-19 條目），此片補齊。

## Scope

1. Migration：`etf_metrics` 加一欄 `bench_0050_inception numeric`
2. `scraper/src/activeetf/metrics.py::compute_all()`：`bench_0050` series 已在函式開頭載入，新增一行 `"bench_0050_inception": inception_return(bench_0050, today)`，寫進 `row` dict（沿用既有 `_write_metrics` 寫入路徑）
3. Backfill：對 `etf_metrics` 既有列補算此欄（可用簡單腳本：對每個有記錄的 `(etf_id, trade_date)` 重跑 `inception_return(bench_0050, trade_date)`，或直接重跑一次 `compute_all` 覆蓋最新一列——舊歷史列若無 backfill 需求可留空，由 User 裁決 backfill 深度）
4. 前端：`web/lib/rankings.ts` 的 `RankingRow` 型別加 `bench00501nception`（或依現有命名慣例）欄位；`web/components/etf-detail/performance-summary.tsx` 與 `web/components/rankings-table.tsx` 把「上市以來」列的 `benchmark: null` 改為指向新欄位；欄位為 null 時仍顯示 `—`（歷史缺 backfill 的列）

## Non-goals

- 不改變其他期間（1/3/6 月、1 年）的既有計算
- 不在前端計算此基準——一律讀 `etf_metrics.bench_0050_inception`
- 選股勝率揭露文字（spec §6 另一條）不在本片範圍，見 PR #14 review 的獨立修正

## Context to Read

- `docs/superpowers/specs/2026-07-04-active-etf-tracker-design.md` §6（2026-07-19 註記段）
- `scraper/src/activeetf/metrics.py`（`inception_return()` line 46、`compute_all()` line 148 起，`bench_0050` 已載入於 line 153）
- `scraper/migrations/`（既有欄位新增的 migration 寫法，比照 004/005 慣例）
- `web/components/etf-detail/performance-summary.tsx`、`web/components/rankings-table.tsx`（顯示層）

## Expected Files

- `scraper/migrations/00N_etf_metrics_bench_inception.sql`
- `scraper/src/activeetf/metrics.py`（一行新增）
- `scraper/tests/test_metrics.py`（新增一個測試：`compute_all` 寫入的 row 含 `bench_0050_inception`，值等於 `inception_return(bench_0050, today)`）
- `web/lib/rankings.ts`、`web/components/etf-detail/performance-summary.tsx`、`web/components/rankings-table.tsx`（顯示改動）

## Acceptance Criteria

- `uv run pytest` 全綠，含新測試
- `npm test` / `tsc --noEmit` / `lint` / `build` 全過
- 真資料驗證：任一 ETF 的「上市以來」列不再顯示「無同期基準」，改顯示 0050 同期報酬數字

## Required Verification

- Generator 撰寫整合測試（無 `SUPABASE_DB_URL` 自動 skip）；migration 套用與 backfill 執行由 User 或授權 session 進行，執行輸出貼進 PR body
- 真資料 smoke：挑一檔 ETF 手算比對（`inception_return` 邏輯簡單，可用 spreadsheet 對帳）

## Risks

- backfill 深度是唯一待 User 裁決的小事項：全歷史重算 vs 僅最新列。建議最新列即可（歷史列本來就不是使用者常看的日期），Generator 開工前若對此有疑慮應在 PR body 註明選擇與理由，不需回頭等裁決卡住進度

## Handoff Prompt

請以 Generator 身分依本 handoff 實作。完成後開 PR（base `main`），PR body 含變更摘要、驗證指令與輸出、backfill 範圍與理由、已知風險。不對正式 DB 執行語句——migration 套用與 backfill 執行需 User 或授權 session 進行；PR 可先以 draft 開，等待該步驟完成後再轉 ready。
