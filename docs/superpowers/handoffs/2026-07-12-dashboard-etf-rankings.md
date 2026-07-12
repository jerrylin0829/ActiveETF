# Generator handoff — Dashboard 第一片：ETF 排行榜

Planner：Claude Code ｜ 日期：2026-07-12 ｜ 目標分支前綴：`codex/`

## Goal

建立 `web/` 前端專案並完成 Dashboard 的第一個頁面「ETF 排行榜」（spec §7 ②）。這是前端的第一片，目的是一次打通整個技術棧（Next.js App Router + Tailwind + shadcn/ui + Supabase 唯讀連線 + Vercel 部署設定），並用一個自包含、單一資料來源的頁面驗證這條路走得通。之後的首頁、個別頁、個股反查頁再逐片疊加。

## Scope

1. 在 `web/` 下 scaffold Next.js（App Router、TypeScript）+ Tailwind + shadcn/ui。
2. 建立 Supabase **唯讀** client：用 **anon key + project URL**（非 service key、非 DB 連線字串），走 RLS 匿名唯讀（policies 已在 `scraper/migrations/001_schema.sql` 建好）。
3. ETF 排行榜頁：以 server component 查詢 `etf_metrics ⋈ etf`（取每檔最新 `trade_date` 的那列），渲染為**可排序表格**，欄位：
   - ETF 代號 + 名稱、投信
   - 報酬：`ret_1m` / `ret_3m` / `ret_6m` / `ret_1y` / `ret_inception`（期間不足顯示 `—`）
   - 對照基準：`bench_0050_1m/3m/6m/1y`（並列同期）
   - 擇時勝率：`timing_wins/timing_months` → 顯示 `67%（8/12）`，永遠帶樣本數
   - 選股勝率：拆已實現 `picking_realized_wins/total` 與未平倉 `picking_open_wins/total`，各帶樣本數；樣本 <10 淡化並標「樣本不足」
   - `median_holding_days`、`weekly_turnover_pct`
4. **標色**：報酬/勝率贏過同期基準時標色，遵循台股 **紅漲綠跌**（漲=紅、跌=綠）。
5. **空狀態**：`etf_metrics` 目前為空（見 Risks），頁面在無資料時顯示 spec §7 要求的**資料缺口黃色警示條**，不可白屏或報錯。
6. **手機響應式**：表格在窄螢幕要可用（橫向捲動或卡片式，Generator 自行取捨）。
7. Vercel 部署設定（`web/` 為 root、環境變數說明），但**不需實際觸發部署**。
8. 補 `web/.env.local.example`（列 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`）與 `web/.gitignore`（忽略 `.env*.local`、`.next/`、`node_modules/`）。

## Non-goals

- 其餘三頁（首頁今日總覽、ETF 個別頁、個股反查頁）——之後各自一片。
- 任何 pipeline / scraper / DB schema 變更。
- **前端不做任何指標計算**——只 SELECT 衍生表（spec §3 鐵則）。
- 產業圓餅圖、折線圖等 Recharts 視覺化（屬個別頁，本片不做；本片純表格）。
- 實際 Vercel 部署與網域設定。
- 深色模式切換：shadcn 預設帶 dark 樣式即可，不需做手動 toggle（全站深色模式列後續片）。
- **「規模 / AUM」欄位不做**：spec §7 ② 列了「規模」，但 `etf` 表與現有資料源都沒有 AUM 欄位（見 Risks）。本片省略，列為 follow-up。

## Context to Read

- `CLAUDE.md`（資料原則、紅漲綠跌、繁中文案、前端只 SELECT）
- `docs/superpowers/specs/2026-07-04-active-etf-tracker-design.md` §3（架構：anon key + RLS 唯讀）、§4（資料模型）、§6（指標定義，理解每個欄位語意）、§7 ②（排行榜頁需求）
- `scraper/migrations/001_schema.sql`（`etf`、`etf_metrics` 欄位與 RLS policies 的實際定義）
- `docs/superpowers/process/pr-review-checklist.md`（Evaluator 會用的 gate，Frontend + Operations 段）

## Expected Files

- `web/`：Next.js scaffold（`package.json`、`next.config`、`tsconfig.json`、`tailwind.config`、`app/`、`components/ui/`（shadcn）等）
- `web/lib/supabase.ts`（或類似）：唯讀 client
- `web/app/rankings/page.tsx`（或設為首頁 `app/page.tsx`，Generator 取捨）：排行榜頁
- `web/components/`：排行榜表格、資料缺口黃條等元件
- `web/.env.local.example`、`web/.gitignore`
- 若需要，`vercel.json` 或在 README 補部署說明

## Acceptance Criteria

- `web/` 下 `npm run build` 與 `npm run lint`（或 pnpm/yarn 對應指令）通過。
- 頁面能從 Supabase 讀 `etf_metrics ⋈ etf` 並列出各檔最新一列；**有資料時**正確渲染 28 檔（或當前有 metrics 的檔數），欄位對應 §6 語意無誤。
- **無資料時**顯示資料缺口黃條，不白屏、不報錯。
- 表格可依各報酬/勝率欄排序。
- 標色遵循紅漲綠跌，且僅在「贏過同期基準」時上色。
- 勝率永遠帶樣本數；選股勝率拆已實現/未平倉；樣本 <10 標「樣本不足」。
- 窄螢幕（375px）可用。
- 全站文案繁體中文。
- 前端無任何指標重算邏輯——所有數字直接來自 `etf_metrics`。

## Required Verification

- `npm run build`、`npm run lint`：貼輸出。
- **手動 smoke（兩種狀態都要驗）**：
  - **空狀態**：直接連現有 Supabase（`etf_metrics` 目前為空）→ 截圖或描述資料缺口黃條正常顯示。
  - **有資料狀態**：因真資料要等週一排程，Generator 需在**本機**暫時 seed 幾列假 `etf_metrics`（挑 3–5 檔、涵蓋「贏基準」與「輸基準」、樣本 <10 與 ≥10）→ 截圖或描述排序、標色、樣本數顯示正確 → **驗證後清掉這些假列**（勿污染正式庫；用可辨識的方式插入再刪除）。
- 依 review gate：本片涉及外部依賴（Supabase 連線），smoke test 證據必附，不可只靠讀 diff。

## Risks

- **資料尚未產生**：`holdings_snapshot` / `holding_change` / `etf_metrics` 目前皆為 0 筆，要等週一 18:30 排程第一次真跑才有。排行榜頁的「有資料」渲染因此只能靠本機 seed 假資料驗證（見 Required Verification）。空狀態處理是本片的硬需求，不是 nice-to-have。
- **憑證與現有的不同**：前端用的是 **anon key + project URL**（Supabase 控制台 Settings → API），與 pipeline 用的 `SUPABASE_DB_URL`（DB 連線字串）、service key 都不同。anon key 設計上可公開（配 RLS），放 `NEXT_PUBLIC_*` 沒問題，但仍不要 commit 進 repo；`web/.env.local` 要被 gitignore。User 需另外提供 anon key + URL。
- **spec 與 schema 落差（規模欄）**：spec §7 ② 列「規模」，但無資料源與欄位。本片省略並列 follow-up；若 Evaluator 依 spec 逐項對，需知道這是 Planner 已決定的暫時取捨，非遺漏。
- **RLS 驗證**：migration 已對 7 張表建 anon `select using (true)`。Generator 應確認 anon key 真能讀到 `etf` / `etf_metrics`；若讀不到，先查 RLS policy 是否生效，而非改用 service key。
- **套件管理器**：`scraper/` 用 uv，但 `web/` 是 Node 生態。Generator 自選 npm/pnpm/yarn，於 PR 註明並在 `web/` 補對應 lockfile。

## Handoff Prompt

請以 Codex Generator 身分依本 handoff 實作。完成後開 PR（base 為 `main`），PR body 請包含變更摘要、驗證指令與輸出、兩種狀態的 smoke 證據、已知風險與後續工作。不得在未驗證時宣稱完成；有資料狀態的驗證請用本機暫時 seed 假 `etf_metrics` 並於驗證後清除，勿污染正式庫。
