# ETF 個別頁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 `/etf/[etfId]`，以單一 ETF 視角呈現績效、最新持股、產業配置、近 30 個交易日異動，以及一檔持股的全期權重歷史。

**Architecture:** Next.js server page 只呼叫 read-only Supabase data layer；純函式負責快照差分、日期回推、產業聚合與折線斷點。持股表以 `?stock=` 選擇圖表股票，server 每次只查一檔股票全期資料，避免下載一檔 ETF 的全部持股歷史。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、Supabase JS、Recharts、Tailwind CSS、Vitest、Testing Library。

## Global Constraints

- `holdings_snapshot` 是 append-only 事實來源；本片只讀，不做 migration 或正式 DB 寫入。
- 前端不可計算報酬；績效只讀 `etf_metrics`。快照權重相減與產業加總是 handoff 核可的呈現層運算。
- 前日與 20 日前皆以該 ETF 實際 `holdings_snapshot` 交易日序列回推；20 日前不存在時顯示 `—`。
- `open_position.holding_days >= 20` 顯示「長抱」；查無回合時顯示 `—`，不可推定進場日。
- 交易事件與數字使用繁體中文、`web/lib/format.ts`，市場標色紅漲綠跌。
- 查詢必須 deterministic pagination；不得因 Supabase 1,000-row 上限漏資料。
- 375px 不得產生頁面級橫向溢出；寬表只能在自己的容器內捲動。

---

### Task 1: 純邏輯與 view model

**Files:**
- Create: `web/lib/etf-detail.ts`
- Create: `web/lib/etf-detail.test.ts`

**Interfaces:**
- Produces: `buildHoldingRows()`, `aggregateIndustryWeights()`, `buildWeightHistory()`, `sortHoldingRows()`, `resolveSelectedStockId()`。
- Produces types: `EtfHoldingRow`, `SnapshotHolding`, `OpenPositionValue`, `IndustryWeight`, `WeightHistoryPoint`, `EtfChangeEvent`, `EtfDetailViewModel`。

- [ ] **Step 1: Write failing tests for snapshot differences and holding days**

```ts
expect(buildHoldingRows({
  current: [{ stockId: "2330", shares: 1000, weightPct: 12 }],
  previous: [],
  twentyDaysAgo: null,
  stockInfo: new Map([["2330", { name: "台積電", industry: "半導體業" }]]),
  openPositions: [{ stockId: "2330", entryDate: "2026-06-01", holdingDays: 20 }],
})[0]).toMatchObject({ previousChange: "NEW", twentyDayChange: null, holdingDays: 20, isLongHeld: true });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- web/lib/etf-detail.test.ts`

Expected: FAIL because `@/lib/etf-detail` does not exist.

- [ ] **Step 3: Implement typed pure functions**

`buildHoldingRows()` must use current snapshot as membership, subtract missing stocks as zero only when the comparison date exists, emit `"NEW"` only for the previous-day column, and select the latest `entryDate` if duplicate open rounds exist. `buildWeightHistory()` must merge EXIT dates as `{ weightPct: null }`; `sortHoldingRows()` must place null values last with `stockId` tie-breakers.

- [ ] **Step 4: Add boundary tests**

Cover current-only membership, previous NEW, 20-day missing date, 20-day absent stock as `+current weight`, unknown stock metadata, latest open round, day 19/20 badge boundary, industry `未分類`, EXIT null break, selected stock fallback, and all sortable numeric fields.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- web/lib/etf-detail.test.ts`

Expected: all focused tests PASS.

Commit: `feat: 新增 ETF 個別頁資料邏輯`

---

### Task 2: Bounded read-only Supabase data layer

**Files:**
- Create: `web/lib/etf-detail-data.ts`
- Create: `web/lib/etf-detail-data.test.ts`

**Interfaces:**
- Consumes: Task 1 types and pure functions; `mapMetricRecord()` from `web/lib/rankings-data.ts`; `latestUnresolvedScrapeFailures()` from `web/lib/rankings.ts`.
- Produces: `fetchEtfDetail(etfId: string, requestedStockId?: string): Promise<EtfDetailResult>`.
- `EtfDetailResult` contains `found`, ETF identity, latest/comparison dates, latest metric, current holding rows, pie slices, timeline rows, selected stock, weight history, data-gap warnings, and read error.

- [ ] **Step 1: Write failing data-query tests**

Build a Supabase query double that records filters, complete order columns, ranges, and limits. Assert an unknown ETF returns `found: false`; a known ETF resolves its own latest 30 snapshot dates; comparison snapshots are limited to latest/previous/index-20; stock metadata only receives current stock IDs; timeline is bounded to 30 ETF trading dates; selected history filters both `etf_id` and `stock_id`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- web/lib/etf-detail-data.test.ts`

Expected: FAIL because `fetchEtfDetail()` does not exist.

- [ ] **Step 3: Implement deterministic pagination**

Use a shared local `fetchPaged()` with page size 1,000. Complete orders:

```ts
holdings_snapshot: trade_date -> stock_id
holding_change: trade_date -> stock_id
open_position: stock_id -> entry_date
selected stock history: trade_date -> stock_id
scrape_log: run_at -> id
```

Discover the ETF's latest 30 actual snapshot dates by paging `dashboard_holding_snapshot_dates` at or after `etf.listed_date`, probing only those date chunks for the selected ETF, and stopping once 30 matching dates are found or the listed-date window is exhausted.

- [ ] **Step 4: Implement data-gap warnings**

Warn when the ETF has no snapshot, its latest snapshot is older than the global latest snapshot date, the latest scrape attempt for an ETF/date is failed, or an `open_position.as_of_date` lags the current snapshot. Preserve partial data and join all query errors with `；`.

- [ ] **Step 5: Verify bounded and paged behavior**

Add >1,000-row fixtures for snapshots/timeline/history and assert the second page is requested under complete ordering. Add a large unrelated historical dataset and assert the page does not query unrelated holdings history.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- web/lib/etf-detail-data.test.ts web/lib/etf-detail.test.ts`

Expected: all focused tests PASS.

Commit: `feat: 新增 ETF 個別頁唯讀查詢`

---

### Task 3: 績效、產業與異動區塊

**Files:**
- Create: `web/components/etf-detail/performance-summary.tsx`
- Create: `web/components/etf-detail/industry-pie-chart.tsx`
- Create: `web/components/etf-detail/change-timeline.tsx`
- Create: `web/components/etf-detail/summary-sections.test.tsx`

**Interfaces:**
- Consumes: `RankingRow | null`, `IndustryWeight[]`, `EtfChangeEvent[]`.
- Reuses: `formatReturn()`, `formatTurnover()`, `formatNumber()`, `formatWinRate()`, `buildPickingSummary()` and `web/lib/format.ts`.

- [ ] **Step 1: Write failing rendering tests**

Assert return plus 0050 benchmark, realized/open win rates with sample counts, sample-under-10 badge, style metrics, `未分類` pie slice, and NEW/ADD red versus TRIM/EXIT green timeline badges.

- [ ] **Step 2: Verify RED**

Run: `npm test -- web/components/etf-detail/summary-sections.test.tsx`

- [ ] **Step 3: Implement components**

Use an unframed responsive metric grid; no nested cards. Use Recharts `PieChart` with the existing eight `--rotation-chart-*` variables, `ResizeObserver`, tooltip weight formatting, and an explicit empty state. Timeline groups descending events by date and uses semantic lists.

- [ ] **Step 4: Verify responsive-safe rendering and commit**

Run: `npm test -- web/components/etf-detail/summary-sections.test.tsx`

Commit: `feat: 新增 ETF 績效與配置區塊`

---

### Task 4: 可排序持股表與單股權重折線

**Files:**
- Create: `web/components/etf-detail/holdings-table.tsx`
- Create: `web/components/etf-detail/weight-history-chart.tsx`
- Create: `web/components/etf-detail/holdings-explorer.test.tsx`

**Interfaces:**
- Consumes: `EtfHoldingRow[]`, `WeightHistoryPoint[]`, `etfId`, `selectedStockId`.
- Navigation contract: row activation calls `router.push('/etf/<encoded-etf>?stock=<encoded-stock>#weight-history')`.

- [ ] **Step 1: Write failing interaction tests**

Assert default weight-desc order, sort toggles, NEW versus numeric versus `—` difference cells, `19` without badge, `20` with badge, row click, Enter/Space keyboard activation, current row state, and no selected-history data empty state.

- [ ] **Step 2: Verify RED**

Run: `npm test -- web/components/etf-detail/holdings-explorer.test.tsx`

- [ ] **Step 3: Implement accessible table interaction**

Use lucide sort icons, `role="link"`, `tabIndex={0}`, `aria-current`, click and keyboard handlers. Keep the minimum table width inside an `overflow-x-auto min-w-0` container. Format weight and changes with `formatPct` / `formatSignedPct`, shares with `formatLots`.

- [ ] **Step 4: Implement chart gaps**

Use Recharts `LineChart` with `connectNulls={false}`, fixed-height responsive measurement, date X axis, percent Y axis, and a marker for a one-point history.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- web/components/etf-detail/holdings-explorer.test.tsx web/lib/etf-detail.test.ts`

Commit: `feat: 新增 ETF 持股探索互動`

---

### Task 5: Dynamic route and entry links

**Files:**
- Create: `web/app/etf/[etfId]/page.tsx`
- Create: `web/app/etf/[etfId]/page.test.tsx`
- Modify: `web/components/rankings-table.tsx`
- Modify: `web/components/rankings-table.test.tsx`
- Modify: `web/components/cross-holdings-table.tsx`
- Modify: `web/components/cross-holdings-table.test.tsx`
- Modify: `web/components/today-overview-dashboard.tsx`
- Modify: `web/components/today-overview-dashboard.test.tsx`

**Interfaces:**
- Route receives `params: Promise<{ etfId: string }>` and `searchParams: Promise<{ stock?: string }>`.
- Unknown ETF calls `notFound()`; known ETF renders all Task 3/4 sections and `DataGapAlerts`.

- [ ] **Step 1: Write failing route and link tests**

Mock `fetchEtfDetail()` and `next/navigation`. Assert unknown ID calls `notFound`, a known ETF renders its literal ID/name and current date, errors/warnings remain visible, and each required source component links ETF names to `/etf/[etfId]`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- web/app/etf/[etfId]/page.test.tsx web/components/rankings-table.test.tsx web/components/cross-holdings-table.test.tsx web/components/today-overview-dashboard.test.tsx`

- [ ] **Step 3: Implement the page**

Use the existing `SiteNav` without adding an item. The first viewport identifies the ETF with an H1 containing ID and name. Render Supabase errors and data-gap warnings above the sections; preserve empty states instead of inventing data.

- [ ] **Step 4: Add source links without changing source interactions**

Use `next/link`; stop propagation inside the cross expanded detail link if necessary so the parent expansion state does not change. Keep current sorting and expansion tests green.

- [ ] **Step 5: Run focused tests and commit**

Commit: `feat: 新增 ETF 個別頁與入口連結`

---

### Task 6: Full verification and read-only smoke

**Files:**
- Modify only files required by failures found in this task.

- [ ] **Step 1: Run all frontend gates**

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

- [ ] **Step 2: Run local production-like server**

Start on an unused port with the public Supabase environment. Verify `/etf/00981A`, `/etf/unknown`, `/rankings`, `/cross`, and `/` HTTP behavior.

- [ ] **Step 3: Browser smoke at desktop and 375px**

Verify the pie and line SVG contain visible paths, row selection switches `?stock=`, the document width equals the viewport, and console has 0 errors/warnings.

- [ ] **Step 4: Read-only real-data reconciliation**

For `00981A`, compare three latest holding weights shown by the page with read-only Supabase rows and the issuer PCF page. Do not write formal Supabase. Record any issuer timing mismatch as a risk instead of altering data.

- [ ] **Step 5: Final commit if verification required fixes**

Commit format: `fix: 修正 ETF 個別頁驗收問題`

- [ ] **Step 6: Push and open Draft PR**

PR base is `main`. Body includes summary, exact commands/output, desktop/mobile and both chart evidence, true-data three-row reconciliation, known risks, no formal DB writes, and any follow-up work.
