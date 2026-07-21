# 個股反查頁實作計畫

> **Generator：Codex。** 依 `docs/superpowers/handoffs/2026-07-17-stock-lookup-page.md` 執行；每個邏輯單位採 TDD 並獨立 commit。

**Goal：** 新增 `/stock/[stockId]`，從個股視角呈現最新持有 ETF、全體合計權重走勢與最近 30 個交易日事件，並補齊既有頁面的股票入口。

**Architecture：** Next.js server route 透過 Supabase anon client 做唯讀、具範圍與穩定排序的查詢；純函式負責資料映射、排序與圖表範圍裁切；互動圖表與表格留在 client component。前端只呈現 pipeline 已產出的權重、持有日與事件，不計算報酬。

**Tech Stack：** Next.js 16 App Router、React 19、TypeScript、Supabase JS、Recharts、Tailwind CSS、Vitest + Testing Library。

---

## Task 1：純資料模型與範圍裁切

**Files：**
- Create: `web/lib/stock-lookup.ts`
- Create: `web/lib/stock-lookup.test.ts`

1. 先寫失敗測試，涵蓋：
   - 持有 ETF 預設依權重降冪，權重相同以 `etfId` 穩定排序。
   - `holdingDays >= 20` 標示長抱；無 open position 保持 `null`。
   - `1M`、`3M`、`6M`、`all` 僅裁切圖表顯示序列，不改動來源資料。
   - 不合法 range 正規化為 `3M`。
2. 執行 `npm test -- web/lib/stock-lookup.test.ts`，確認因 module 尚不存在而失敗。
3. 實作型別、映射 helper、排序與日期範圍純函式。
4. 重跑 focused test，確認通過。
5. Commit：`feat: 建立個股反查資料模型`

## Task 2：唯讀 Supabase 資料層

**Files：**
- Create: `web/lib/stock-lookup-data.ts`
- Create: `web/lib/stock-lookup-data.test.ts`

1. 建立 Supabase query double，先寫失敗測試：
   - `holdings_snapshot` 查無該代號時回傳 `found: false`，不誤報 404 為讀取錯誤。
   - 最新日期以該股票最新 `cross_holdings_daily.trade_date` 為準；最新持有表與 header 使用同一天。
   - metadata 缺漏時名稱 fallback 為代號、產業為「未分類」。
   - `holdings_snapshot`、`holding_change`、`open_position` 超過 1,000 筆時分頁，排序分別完整包含 `trade_date, etf_id, stock_id` 或對應 PK。
   - 事件只查全站最近 30 個實際快照交易日所涵蓋的日期範圍，不用 30 個日曆日。
   - `stock_info` 與 `etf` 只查實際涉及的 IDs。
   - 任一子查詢錯誤時保留可用部分結果，並回傳可見 error。
   - 股票最新資料早於全站最新快照時產生資料缺口警示。
2. 執行 focused test，確認紅燈。
3. 實作：
   - 先以 `.eq("stock_id", stockId).limit(1)` 判斷歷史存在性。
   - 分頁讀取該股完整 `cross_holdings_daily` 走勢，完整排序 `trade_date, stock_id`。
   - 讀取最新日持股與事件，並只查 holder ETF metadata/open positions。
   - 從 `dashboard_holding_snapshot_dates` 取得最近 30 個交易日，再 bounded 查詢事件。
   - 將查詢錯誤聚合成 `error`，stale 最新日轉為 `DataGapWarning`。
4. 執行 focused tests，確認通過。
5. Commit：`feat: 新增個股反查唯讀查詢`

## Task 3：三個內容區塊元件

**Files：**
- Create: `web/components/stock-lookup/holders-table.tsx`
- Create: `web/components/stock-lookup/holders-table.test.tsx`
- Create: `web/components/stock-lookup/aggregate-trend-chart.tsx`
- Create: `web/components/stock-lookup/aggregate-trend-chart.test.tsx`
- Create: `web/components/stock-lookup/stock-event-history.tsx`
- Create: `web/components/stock-lookup/stock-event-history.test.tsx`

1. 先寫元件測試：
   - 持有表顯示 ETF link、權重、張數、異動 badge、持有天數與長抱；缺值顯示 `—`。
   - 漲與加碼用紅色、跌與減碼用綠色。
   - 圖表具兩條線、左右 Y 軸、range links，單點資料仍可見。
   - 事件依日期新到舊，ETF 連結正確，空狀態清楚。
2. 執行三個 focused tests，確認紅燈。
3. 實作 quiet dashboard layout：section 不套浮動卡；只有表格容器有邊框；外層與 grid child 加 `min-w-0`，表格只在自身容器橫向捲動。
4. 重跑 focused tests，確認通過。
5. Commit：`feat: 新增個股反查內容元件`

## Task 4：動態路由與錯誤狀態

**Files：**
- Create: `web/app/stock/[stockId]/page.tsx`
- Create: `web/app/stock/[stockId]/page.test.tsx`

1. 先寫 route 測試：
   - 未知股票呼叫 `notFound()`。
   - Supabase 讀取錯誤顯示黃色錯誤區，不誤導為 404。
   - 頁首顯示代號、名稱、產業、最新日期與持有 ETF 數。
   - `DataGapAlerts`、三個內容區塊與多代號限制註記存在。
2. 實作 `force-dynamic` server page；對 route param 使用 decoded stock ID 查詢，link 端一律 `encodeURIComponent`。
3. 執行 route test、TypeScript 與 lint。
4. Commit：`feat: 新增個股反查頁路由`

## Task 5：補齊站內股票入口

**Files：**
- Modify: `web/components/cross-holdings-table.tsx`
- Modify: `web/components/cross-holdings-table.test.tsx`
- Modify: `web/components/today-overview-dashboard.tsx`
- Modify: `web/components/today-overview-dashboard.test.tsx`

1. 先更新測試，要求：
   - 交集主列及展開明細的股票名稱可連至 `/stock/[stockId]`，點連結不觸發列展開切換。
   - 異動牆與新倉雷達股票名稱可連至個股頁；海外代號正確 URL encode。
2. 執行 focused tests，確認紅燈。
3. 加入 Next `Link`，維持原本 ETF links、排序與展開操作。
4. 重跑 focused tests，確認通過。
5. Commit：`feat: 串接個股反查站內入口`

## Task 6：完整驗證與 Draft PR

1. 建立未追蹤的 `web/.env.local`，只放 handoff 已授權的 anon 唯讀環境值；確認 `git status` 不包含該檔。
2. 執行：
   - `npm test`
   - `npx tsc --noEmit`
   - `npm run lint`
   - `npm run build`
   - `git diff --check origin/main...HEAD`
   - `npm audit --audit-level=moderate`（如仍為既有 advisory，照實記錄，不使用 `--force`）
3. 啟動 production build 或 dev server，browser smoke：
   - `/stock/2330` 三區塊、雙線、ETF links、console 0 error/warning。
   - 選一個正式資料中的海外 ID：頁面 200、未分類、持有日 `—`、無文件級橫向溢出。
   - 未知 ID 404。
   - 375px 與 1280px 文件寬度、表格容器捲動與圖表非空。
4. 用正式 Supabase anon 唯讀抽查：
   - `2330` 一日走勢數值等於同日 `cross_holdings_daily`。
   - 最新持有 ETF 與 `/cross` 同日展開明細一致。
5. 視 TSX 變更執行 React best-practices 檢查，修正具體問題後重跑必要驗證。
6. Push `codex/stock-lookup-page`，開 Draft PR（base `main`）；PR body 記錄變更摘要、逐條指令與輸出、兩檔真資料 smoke、已知風險與後續工作，明確說明未寫入正式 Supabase。

