# Generator handoff — bench_0050_inception 補欄

Planner：Claude Code ｜ 日期：2026-07-19 ｜ 目標分支前綴：`codex/`

## 設計決策清單

- ✅ 已裁決：`etf_metrics` 新增 `bench_0050_inception numeric` 欄，由 pipeline 計算並寫入
- ✅ 已裁決（User 2026-07-23）：0050 起點對齊每檔 ETF 在 `as_of` 日以前的第一個有效還原價日，再重用既有 `inception_return()`；不得把固定載入起點 2025-05-01 當成所有 ETF 的共同起點
- ✅ 已裁決：backfill 對既有 `etf_metrics` 全表補算（欄位可從既有快取的 `stock_price` 重算，符合資料原則 1）

## Goal

`etf_metrics` 缺「上市以來」同期 0050 基準（`bench_0050_1m/3m/6m/1y` 都有，唯獨 inception 沒有），導致 ETF 個別頁與排行榜的「上市以來」列顯示「無同期基準」——這是 spec §6「旁列同期基準」規則的資料缺口（已在 spec 加註記，見 2026-07-19 條目），此片補齊。

## Scope

1. Migration：`etf_metrics` 加一欄 `bench_0050_inception numeric`
2. `scraper/src/activeetf/metrics.py::compute_all()`：`bench_0050` series 已在函式開頭載入；先依 ETF series 的第一個有效日期裁切 benchmark，再以 `inception_return()` 計算並寫入 `"bench_0050_inception"`（沿用既有 `_write_metrics` 寫入路徑）
3. Backfill：對 `etf_metrics` 既有全歷史列補算此欄；每個 `(etf_id, trade_date)` 均依該 ETF 當時第一個有效還原價日對齊 0050，僅使用 `stock_price` 既有快取
4. 前端：`web/lib/rankings.ts` 的 `RankingRow` 型別加 `bench0050Inception` 欄位；`web/components/etf-detail/performance-summary.tsx` 與 `web/components/rankings-table.tsx` 把「上市以來」列的 `benchmark: null` 改為指向新欄位；欄位為 null 時仍顯示 `—`（歷史缺 backfill 的列）

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

- 全歷史 backfill 會更新所有既有 `etf_metrics` 列；缺 ETF 或 0050 還原價者保持 `null` 並在腳本輸出計數，不以錯誤價格推定補值

## Handoff Prompt

請以 Generator 身分依本 handoff 實作。完成後開 PR（base `main`），PR body 含變更摘要、驗證指令與輸出、backfill 範圍與理由、已知風險。不對正式 DB 執行語句——migration 套用與 backfill 執行需 User 或授權 session 進行；PR 可先以 draft 開，等待該步驟完成後再轉 ready。
