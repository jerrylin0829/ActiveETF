# 今日總覽 UX 優化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依 `docs/superpowers/specs/2026-07-22-overview-ux-design.md` 優化今日總覽 UX：集體動向期間擴充（上週/上月）+ 上方更新時間 + 切換不跳頁、海外代號去重複（全站）、pp→%、異動牆重構（內頁籤/市場切換/前 5 筆查看更多/說明/圖例）。

**Architecture:** 全部前端改動，不動 DB/pipeline/指標。共用 helper 放 `web/lib/format.ts`；期間與異動牆的純邏輯放 `web/lib/today-overview.ts`（既有純函式測試檔所在）；異動牆因需客戶端切換而抽成獨立 `"use client"` 元件；集體動向期間切換維持 server 查詢，只加 `scroll={false}`。

**Tech Stack:** Next.js App Router、React、Tailwind、Vitest + Testing Library。

**通用約定：** 指令都在 `web/` 下執行；分支從 main 切 `codex/overview-ux`；commit 格式 `type: 中文描述`；程式碼識別字英文、UI 文案繁中；紅漲綠跌沿用既有 `changeTone`/`badgeTone`。

---

### Task 1: `stockMarket` 市場判別（TDD）

**Files:**
- Modify: `web/lib/format.ts`
- Test: `web/lib/format.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `web/lib/format.test.ts` 檔尾（最後一個 `});` 之後）新增：

```typescript
import { stockMarket } from "@/lib/format";

describe("stockMarket", () => {
  it("純數字台股代號為 tw", () => {
    expect(stockMarket("2330")).toBe("tw");
    expect(stockMarket("6488")).toBe("tw");
  });
  it("結尾兩字母交易所後綴為 overseas", () => {
    expect(stockMarket("MRVL US")).toBe("overseas");
    expect(stockMarket("00660 KS")).toBe("overseas");
    expect(stockMarket("285A JP")).toBe("overseas");
    expect(stockMarket("2330 TT")).toBe("overseas"); // 海外源對台股的表示，刻意歸 overseas
  });
  it("無後綴的英文 ticker 視為 tw 以外——但無空格者仍 tw", () => {
    // 裸 ticker（如 HUBS，無空格後綴）不符 / [A-Z]{2}$/（無前導空格），歸 tw 分類邊界
    expect(stockMarket("HUBS")).toBe("tw");
  });
});
```

註：裸 ticker（無空格）在本專案實際持股中極少，且判別規則以「空格 + 兩字母」為準；此邊界測試僅鎖定規則行為，非產品語意。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- lib/format.test.ts`
Expected: FAIL — `stockMarket` is not exported / not a function

- [ ] **Step 3: 實作**

在 `web/lib/format.ts` 檔尾新增：

```typescript
// 海外持股代號採 Bloomberg 式「代號 交易所」後綴（ US/ JP/ JT/ KS/ KP/ CH/ TT…）；
// stock_info 只有台股，故以後綴判別市場。
export function stockMarket(stockId: string): "tw" | "overseas" {
  return / [A-Z]{2}$/.test(stockId) ? "overseas" : "tw";
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- lib/format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/format.ts lib/format.test.ts
git commit -m "feat: 新增海外/台股代號市場判別 helper"
```

---

### Task 2: `formatStockLabel` 代號去重複（TDD）

**Files:**
- Modify: `web/lib/format.ts`
- Test: `web/lib/format.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `web/lib/format.test.ts` 檔尾新增：

```typescript
import { formatStockLabel } from "@/lib/format";

describe("formatStockLabel", () => {
  it("有中文名顯示 代號 名稱", () => {
    expect(formatStockLabel("2330", "台積電")).toBe("2330 台積電");
  });
  it("名稱等於代號（海外 fallback）只顯示代號一次", () => {
    expect(formatStockLabel("MRVL US", "MRVL US")).toBe("MRVL US");
    expect(formatStockLabel("00660 KS", "00660 KS")).toBe("00660 KS");
  });
  it("名稱為空只顯示代號", () => {
    expect(formatStockLabel("AAPL US", "")).toBe("AAPL US");
    expect(formatStockLabel("AAPL US", null)).toBe("AAPL US");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- lib/format.test.ts`
Expected: FAIL — `formatStockLabel` is not a function

- [ ] **Step 3: 實作**

在 `web/lib/format.ts` 檔尾新增：

```typescript
// 台股顯示「代號 名稱」；海外股 stock_info 無名稱、name 會 fallback 成 id，
// 此時只顯示代號一次，避免「MRVL US MRVL US」重複。
export function formatStockLabel(stockId: string, stockName: string | null | undefined): string {
  return !stockName || stockName === stockId ? stockId : `${stockId} ${stockName}`;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- lib/format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/format.ts lib/format.test.ts
git commit -m "feat: 新增股票代號去重複顯示 helper"
```

---

### Task 3: `formatWeightDelta` pp → %（TDD）

**Files:**
- Modify: `web/lib/today-overview.ts:289-292`
- Test: `web/lib/today-overview.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `web/lib/today-overview.test.ts` 檔尾新增：

```typescript
import { formatWeightDelta } from "@/lib/today-overview";

describe("formatWeightDelta", () => {
  it("以 % 呈現、兩位小數、帶正負號", () => {
    expect(formatWeightDelta(0.05)).toBe("+0.05%");
    expect(formatWeightDelta(1.2345)).toBe("+1.23%");
    expect(formatWeightDelta(-0.866)).toBe("-0.87%");
    expect(formatWeightDelta(0)).toBe("+0.00%");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- lib/today-overview.test.ts`
Expected: FAIL — 目前回傳 `+0.0500pp` 不等於 `+0.05%`

- [ ] **Step 3: 實作**

把 `web/lib/today-overview.ts` 檔尾的 `formatWeightDelta` 改為：

```typescript
export function formatWeightDelta(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- lib/today-overview.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/today-overview.ts lib/today-overview.test.ts
git commit -m "feat: 權重變化顯示由 pp 改為 %"
```

---

### Task 4: 期間擴充 `rangeBounds` + 上週/上月（TDD）

**Files:**
- Modify: `web/lib/today-overview.ts`（`OverviewRange` 型別、新增 `rangeBounds`）
- Modify: `web/lib/today-overview-data.ts`（`normalizeRange`、查詢用 `rangeBounds`、`buildRangeOptions`）
- Test: `web/lib/today-overview.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `web/lib/today-overview.test.ts` 檔尾新增：

```typescript
import { rangeBounds } from "@/lib/today-overview";

describe("rangeBounds", () => {
  // 2026-07-22 是週三
  it("當日：起訖同為 selectedDate", () => {
    expect(rangeBounds("2026-07-22", "day")).toEqual({ start: "2026-07-22", end: "2026-07-22" });
  });
  it("本週：週一 → selectedDate", () => {
    expect(rangeBounds("2026-07-22", "week")).toEqual({ start: "2026-07-20", end: "2026-07-22" });
  });
  it("上週：上週一 → 上週五", () => {
    expect(rangeBounds("2026-07-22", "week_prev")).toEqual({ start: "2026-07-13", end: "2026-07-17" });
  });
  it("本月：當月 1 日 → selectedDate", () => {
    expect(rangeBounds("2026-07-22", "month")).toEqual({ start: "2026-07-01", end: "2026-07-22" });
  });
  it("上月：上月 1 日 → 上月最後一日", () => {
    expect(rangeBounds("2026-07-22", "month_prev")).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- lib/today-overview.test.ts`
Expected: FAIL — `rangeBounds` 不存在、型別不含 `week_prev`/`month_prev`

- [ ] **Step 3: 實作型別與 `rangeBounds`**

在 `web/lib/today-overview.ts`，把 `OverviewRange` 改為：

```typescript
export type OverviewRange = "day" | "week" | "week_prev" | "month" | "month_prev";
```

並在檔尾新增（純函式，UTC 計算避免時區飄移）：

```typescript
function addUtcDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function rangeBounds(
  selectedDate: string,
  range: OverviewRange,
): { start: string; end: string } {
  const d = new Date(`${selectedDate}T00:00:00Z`);
  const mondayOffset = (d.getUTCDay() + 6) % 7; // 週一為起點
  if (range === "day") {
    return { start: selectedDate, end: selectedDate };
  }
  if (range === "week") {
    return { start: addUtcDays(selectedDate, -mondayOffset), end: selectedDate };
  }
  if (range === "week_prev") {
    const thisMonday = addUtcDays(selectedDate, -mondayOffset);
    return { start: addUtcDays(thisMonday, -7), end: addUtcDays(thisMonday, -3) };
  }
  if (range === "month") {
    return { start: `${selectedDate.slice(0, 7)}-01`, end: selectedDate };
  }
  // month_prev：本月 1 日往前一天 = 上月最後一日
  const lastOfPrevMonth = addUtcDays(`${selectedDate.slice(0, 7)}-01`, -1);
  return { start: `${lastOfPrevMonth.slice(0, 7)}-01`, end: lastOfPrevMonth };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- lib/today-overview.test.ts`
Expected: PASS

- [ ] **Step 5: 接進資料層**

在 `web/lib/today-overview-data.ts`：

(a) 匯入 `rangeBounds`——把既有 import 區塊的 `@/lib/today-overview` 具名匯入加入 `rangeBounds`（並移除即將不用的本地 `rangeStartDate`）。

(b) 刪除本地的 `addDays`、`toDateString`、`rangeStartDate` 三個函式（`rangeBounds` 已取代；`addDays`/`toDateString` 僅被 `rangeStartDate` 使用）。

(c) `normalizeRange` 改為接受 5 值：

```typescript
function normalizeRange(value: string | undefined): OverviewRange {
  return value === "week" || value === "week_prev" || value === "month" || value === "month_prev"
    ? value
    : "day";
}
```

(d) 把 `const startDate = rangeStartDate(selectedDate, range);` 改為：

```typescript
  const { start: rangeStart, end: rangeEnd } = rangeBounds(selectedDate, range);
```

並把 rangeChanges 查詢的日期條件由 `.gte("trade_date", startDate).lte("trade_date", selectedDate)` 改為 `.gte("trade_date", rangeStart).lte("trade_date", rangeEnd)`（`selectedChanges`、`radar` 查詢不變，仍用 selectedDate/radarStartDate）。

(e) `buildRangeOptions` 的 options 陣列改為 5 項（名稱 only，不含日期）：

```typescript
  const options: Array<{ value: OverviewRange; label: string }> = [
    { value: "day", label: "當日" },
    { value: "week", label: "本週" },
    { value: "week_prev", label: "上週" },
    { value: "month", label: "本月" },
    { value: "month_prev", label: "上月" },
  ];
```

- [ ] **Step 6: 型別檢查 + 全套測試**

Run: `npx tsc --noEmit && npm test`
Expected: 無型別錯誤、全 PASS（注意 `OverviewRange` 擴充後 `date-selector.tsx` 的 hidden input 仍傳字串，無需改）

- [ ] **Step 7: Commit**

```bash
git add lib/today-overview.ts lib/today-overview-data.ts lib/today-overview.test.ts
git commit -m "feat: 集體動向新增上週/上月期間"
```

---

### Task 5: 異動牆分組篩選純邏輯 `filterChangeWall`（TDD）

**Files:**
- Modify: `web/lib/today-overview.ts`
- Test: `web/lib/today-overview.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `web/lib/today-overview.test.ts` 檔尾新增（`baseEvent` 已於檔頭定義，可用 spread 覆寫）：

```typescript
import { filterChangeWall } from "@/lib/today-overview";

describe("filterChangeWall", () => {
  const ev = (over: Partial<ChangeEvent>): ChangeEvent => ({ ...baseEvent, ...over });
  const events = [
    ev({ stockId: "2330", changeType: "NEW", weightDeltaPct: 0.5 }),
    ev({ stockId: "2454", changeType: "EXIT", weightDeltaPct: -1.2 }),
    ev({ stockId: "2317", changeType: "ADD", weightDeltaPct: 0.3 }),
    ev({ stockId: "MRVL US", changeType: "NEW", weightDeltaPct: 0.8 }),
    ev({ stockId: "2308", changeType: "TRIM", weightDeltaPct: -0.1 }),
  ];
  it("建倉出清 × 台股：只留 NEW/EXIT 的台股，依權重幅度降冪", () => {
    const result = filterChangeWall(events, "build_exit", "tw");
    expect(result.map((e) => e.stockId)).toEqual(["2454", "2330"]); // |1.2| > |0.5|
  });
  it("建倉出清 × 海外：只留海外", () => {
    const result = filterChangeWall(events, "build_exit", "overseas");
    expect(result.map((e) => e.stockId)).toEqual(["MRVL US"]);
  });
  it("加減碼 × 台股：只留 ADD/TRIM 的台股", () => {
    const result = filterChangeWall(events, "add_trim", "tw");
    expect(result.map((e) => e.stockId)).toEqual(["2317", "2308"]); // |0.3| > |0.1|
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- lib/today-overview.test.ts`
Expected: FAIL — `filterChangeWall` 不存在

- [ ] **Step 3: 實作**

在 `web/lib/today-overview.ts`，先於檔頭 import 區加入 `stockMarket`：

```typescript
import { stockMarket } from "@/lib/format";
```

在檔尾新增：

```typescript
export type ChangeWallTab = "build_exit" | "add_trim";
export type MarketFilter = "tw" | "overseas";

const tabChangeTypes: Record<ChangeWallTab, ChangeType[]> = {
  build_exit: ["NEW", "EXIT"],
  add_trim: ["ADD", "TRIM"],
};

export function filterChangeWall(
  events: ChangeEvent[],
  tab: ChangeWallTab,
  market: MarketFilter,
): ChangeEvent[] {
  return events
    .filter(
      (e) =>
        tabChangeTypes[tab].includes(e.changeType) && stockMarket(e.stockId) === market,
    )
    .sort((a, b) => {
      const diff = Math.abs(b.weightDeltaPct) - Math.abs(a.weightDeltaPct);
      return diff !== 0
        ? diff
        : `${a.etfId}:${a.stockId}`.localeCompare(`${b.etfId}:${b.stockId}`);
    });
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- lib/today-overview.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/today-overview.ts lib/today-overview.test.ts
git commit -m "feat: 異動牆事件類型與市場分組篩選邏輯"
```

---

### Task 6: 全站套用 `formatStockLabel` 去重複

**Files:**
- Modify: `web/components/today-overview-dashboard.tsx`（異動牆、集體動向、雷達的股票顯示）
- Modify: `web/components/etf-detail/holdings-table.tsx`、`web/components/etf-detail/change-timeline.tsx`
- Modify: `web/components/cross-holdings-table.tsx`
- Modify: `web/components/stock-lookup/holders-table.tsx`、`web/components/stock-lookup/stock-event-history.tsx`（若這些檔顯示「代號 名稱」）
- Test: `web/components/today-overview-dashboard.test.tsx`

- [ ] **Step 1: 先定位所有重複顯示點**

Run（在 `web/` 下）：
```bash
grep -rn "stockId}.*stockName\|stock_id}.*name\|{.*Id}</span>.*{.*Name}" components/ | grep -iv test
```
Expected: 列出所有「代號 緊接 名稱」的 JSX。逐一改用 `formatStockLabel(id, name)`。**只改真的會重複的「代號＋名稱並排」處；ETF 名稱（etfId+etfName）不在此規則內，維持原樣。**

- [ ] **Step 2: 寫失敗的元件測試（以今日總覽異動牆為例）**

在 `web/components/today-overview-dashboard.test.tsx` 新增（若無此檔則建立，import 既有 `TodayOverviewDashboard` 與型別；可參考 `rankings-table.test.tsx` 的 render 寫法）：

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TodayOverviewDashboard } from "@/components/today-overview-dashboard";
import type { TodayOverviewViewModel } from "@/lib/today-overview";

function vm(over: Partial<TodayOverviewViewModel> = {}): TodayOverviewViewModel {
  return {
    selectedDate: "2026-07-22",
    availableDates: ["2026-07-22"],
    range: "day",
    rangeOptions: [{ value: "day", label: "當日", href: "/?range=day", active: true }],
    changeEvents: [
      {
        etfId: "00981A", etfName: "主動統一台股增長", issuer: "統一", tradeDate: "2026-07-22",
        stockId: "MRVL US", stockName: "MRVL US", changeType: "NEW", sharesDelta: 1000, weightDeltaPct: 0.8,
      },
    ],
    collective: { increases: [], decreases: [] },
    radarPositions: [],
    warnings: [],
    error: null,
    ...over,
  };
}

describe("TodayOverviewDashboard 海外代號", () => {
  it("海外股不重複顯示代號", () => {
    render(<TodayOverviewDashboard overview={vm()} />);
    // 「MRVL US」只出現一次文字節點，不是「MRVL US MRVL US」
    expect(screen.getByText("MRVL US")).toBeInTheDocument();
    expect(screen.queryByText("MRVL US MRVL US")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npm test -- components/today-overview-dashboard.test.tsx`
Expected: FAIL — 目前渲染成「MRVL US MRVL US」（id + name 兩段）

- [ ] **Step 4: 實作**

`web/components/today-overview-dashboard.tsx`：import `formatStockLabel`（`@/lib/format`），把異動牆股票區塊（原 line 79-83 的兩個 `<span>`：`{event.stockId}` 與 `{event.stockName}`）合併為單一：

```tsx
<span className="font-medium hover:text-primary">
  {formatStockLabel(event.stockId, event.stockName)}
</span>
```

集體動向（原 line 140-144）與雷達（原 line 231-232）同樣把「代號 span + 名稱 span」改為單一 `{formatStockLabel(item.stockId, item.stockName)}` / `{formatStockLabel(position.stockId, position.stockName)}`。其餘檔案（Step 1 grep 出的 etf-detail / cross / stock-lookup 顯示點）比照替換。

- [ ] **Step 5: 跑測試 + 全套**

Run: `npm test -- components/today-overview-dashboard.test.tsx && npx tsc --noEmit && npm test`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add components/ lib/
git commit -m "feat: 全站股票代號去重複顯示"
```

---

### Task 7: 異動牆客戶端元件（頁籤/市場/查看更多/說明/圖例）

**Files:**
- Create: `web/components/change-wall.tsx`（`"use client"`）
- Modify: `web/components/today-overview-dashboard.tsx`（移除內嵌 `ChangeWall`，改用新元件）
- Test: `web/components/change-wall.test.tsx`

- [ ] **Step 1: 寫失敗的元件測試**

`web/components/change-wall.test.tsx`：

```typescript
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ChangeWall } from "@/components/change-wall";
import type { ChangeEvent } from "@/lib/today-overview";

const base: ChangeEvent = {
  etfId: "00981A", etfName: "主動統一台股增長", issuer: "統一", tradeDate: "2026-07-22",
  stockId: "2330", stockName: "台積電", changeType: "NEW", sharesDelta: 1000, weightDeltaPct: 0.5,
};
const ev = (o: Partial<ChangeEvent>): ChangeEvent => ({ ...base, ...o });

// 6 筆台股 NEW/EXIT 用來驗前 5 筆 + 查看更多
const events: ChangeEvent[] = [
  ev({ stockId: "A", changeType: "NEW", weightDeltaPct: 6 }),
  ev({ stockId: "B", changeType: "NEW", weightDeltaPct: 5 }),
  ev({ stockId: "C", changeType: "EXIT", weightDeltaPct: -4 }),
  ev({ stockId: "D", changeType: "NEW", weightDeltaPct: 3 }),
  ev({ stockId: "E", changeType: "EXIT", weightDeltaPct: -2 }),
  ev({ stockId: "F", changeType: "NEW", weightDeltaPct: 1 }),
  ev({ stockId: "G US", stockName: "G US", changeType: "ADD", weightDeltaPct: 0.9 }),
  ev({ stockId: "H", changeType: "ADD", weightDeltaPct: 0.4 }),
];

describe("ChangeWall", () => {
  it("預設建倉出清 × 台股，前 5 筆 + 查看更多", () => {
    render(<ChangeWall events={events} />);
    expect(screen.getAllByTestId("change-row")).toHaveLength(5); // A~E
    expect(screen.queryByTestId("change-row-F")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /查看更多/ })).toBeInTheDocument();
  });
  it("點查看更多展開全部", async () => {
    const user = userEvent.setup();
    render(<ChangeWall events={events} />);
    await user.click(screen.getByRole("button", { name: /查看更多/ }));
    expect(screen.getAllByTestId("change-row")).toHaveLength(6); // A~F
  });
  it("切到加減碼分頁只顯示 ADD/TRIM", async () => {
    const user = userEvent.setup();
    render(<ChangeWall events={events} />);
    await user.click(screen.getByRole("button", { name: "加減碼" }));
    expect(screen.getAllByTestId("change-row")).toHaveLength(1); // 只台股 ADD：H（G US 是海外）
  });
  it("切到海外市場顯示海外事件", async () => {
    const user = userEvent.setup();
    render(<ChangeWall events={events} />);
    await user.click(screen.getByRole("button", { name: "加減碼" }));
    await user.click(screen.getByRole("button", { name: "海外" }));
    expect(screen.getByText("G US")).toBeInTheDocument();
  });
  it("顯示 N/E/A/T 圖例與說明", () => {
    render(<ChangeWall events={events} />);
    expect(screen.getByText(/首次買進/)).toBeInTheDocument();
    expect(screen.getByText(/列出選定交易日/)).toBeInTheDocument();
  });
  it("空分類顯示無異動", async () => {
    const user = userEvent.setup();
    render(<ChangeWall events={[ev({ stockId: "2330", changeType: "NEW", weightDeltaPct: 1 })]} />);
    await user.click(screen.getByRole("button", { name: "海外" }));
    expect(screen.getByText(/此分類當日無異動/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- components/change-wall.test.tsx`
Expected: FAIL — 無法解析 `@/components/change-wall`

- [ ] **Step 3: 實作元件**

`web/components/change-wall.tsx`（紅漲綠跌與 badge 沿用原 dashboard 的 `changeTone`/`badgeTone`，此處複製這兩個小函式；代號用 `formatStockLabel`；權重用 `formatWeightDelta`）：

```tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { formatStockLabel } from "@/lib/format";
import {
  filterChangeWall,
  formatSharesDelta,
  formatWeightDelta,
  type ChangeEvent,
  type ChangeWallTab,
  type MarketFilter,
} from "@/lib/today-overview";
import { cn } from "@/lib/utils";

const changeLabels: Record<ChangeEvent["changeType"], string> = {
  NEW: "NEW", EXIT: "EXIT", ADD: "ADD", TRIM: "TRIM",
};

function changeTone(t: ChangeEvent["changeType"]) {
  return t === "NEW" || t === "ADD" ? "text-[var(--market-up)]" : "text-[var(--market-down)]";
}
function badgeTone(t: ChangeEvent["changeType"]) {
  return t === "NEW" || t === "ADD"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

const TABS: { value: ChangeWallTab; label: string }[] = [
  { value: "build_exit", label: "建倉出清" },
  { value: "add_trim", label: "加減碼" },
];
const MARKETS: { value: MarketFilter; label: string }[] = [
  { value: "tw", label: "台股" },
  { value: "overseas", label: "海外" },
];
const TOP_N = 5;

function Segmented<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
            value === o.value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ChangeWall({ events }: { events: ChangeEvent[] }) {
  const [tab, setTab] = useState<ChangeWallTab>("build_exit");
  const [market, setMarket] = useState<MarketFilter>("tw");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => filterChangeWall(events, tab, market), [events, tab, market]);
  const visible = expanded ? filtered : filtered.slice(0, TOP_N);
  const hiddenCount = filtered.length - visible.length;

  return (
    <section aria-labelledby="change-wall-title" className="space-y-3">
      <div>
        <h2 id="change-wall-title" className="text-xl font-semibold">異動牆</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          列出選定交易日各主動式 ETF 的持股異動事件，可依事件類型與市場切換檢視。
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          新進 NEW＝首次買進｜出清 EXIT＝完全賣出｜加碼 ADD＝增持｜減碼 TRIM＝減持
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented options={TABS} value={tab} onChange={(v) => { setTab(v); setExpanded(false); }} />
        <Segmented options={MARKETS} value={market} onChange={(v) => { setMarket(v); setExpanded(false); }} />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          此分類當日無異動。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="divide-y divide-border">
            {visible.map((event) => (
              <article
                key={`${event.etfId}-${event.stockId}-${event.changeType}`}
                data-testid="change-row"
                className="grid gap-3 px-4 py-3 sm:grid-cols-[6rem_minmax(0,1fr)_8rem_8rem] sm:items-center"
              >
                <div>
                  <Badge variant="outline" className={badgeTone(event.changeType)}>
                    {changeLabels[event.changeType]}
                  </Badge>
                </div>
                <div className="min-w-0">
                  <Link
                    href={`/stock/${encodeURIComponent(event.stockId)}`}
                    className="font-medium hover:text-primary"
                  >
                    {formatStockLabel(event.stockId, event.stockName)}
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">
                    <Link href={`/etf/${encodeURIComponent(event.etfId)}`} className="hover:text-foreground">
                      {event.etfId} {event.etfName}
                    </Link>
                  </div>
                </div>
                <div className={cn("font-mono text-sm font-semibold tabular-nums", changeTone(event.changeType))}>
                  {formatSharesDelta(event.sharesDelta)}
                </div>
                <div className={cn("font-mono text-sm font-semibold tabular-nums", changeTone(event.changeType))}>
                  {formatWeightDelta(event.weightDeltaPct)}
                </div>
              </article>
            ))}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full border-t border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              查看更多（{hiddenCount}）
            </button>
          )}
          {expanded && filtered.length > TOP_N && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="w-full border-t border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              收合
            </button>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- components/change-wall.test.tsx`
Expected: PASS（6 個測試）

- [ ] **Step 5: 接進 dashboard**

`web/components/today-overview-dashboard.tsx`：
- 刪除檔內的 `ChangeWall` 函式（原 line 46-106）與其專用 import（若 `changeLabels`/`changeTone`/`badgeTone` 已無其他使用者則一併移除；雷達仍用 `formatSignedPct`，勿誤刪）
- 新增 import：`import { ChangeWall } from "@/components/change-wall";`
- 主體（原 line 313）`<ChangeWall events={overview.changeEvents} />` 保持呼叫不變（新元件同名同 props）

- [ ] **Step 6: 全套驗證**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: 全過

- [ ] **Step 7: Commit**

```bash
git add components/change-wall.tsx components/change-wall.test.tsx components/today-overview-dashboard.tsx
git commit -m "feat: 異動牆內頁籤/市場切換/查看更多重構"
```

---

### Task 8: 更新時間標示 + 期間切換不跳頁

**Files:**
- Modify: `web/components/today-overview-dashboard.tsx`
- Test: `web/components/today-overview-dashboard.test.tsx`

- [ ] **Step 1: 寫失敗測試**

在 `web/components/today-overview-dashboard.test.tsx` 新增：

```typescript
it("上方顯示資料更新時間為最新交易日", () => {
  render(<TodayOverviewDashboard overview={vm({ availableDates: ["2026-07-22", "2026-07-21"] })} />);
  expect(screen.getByText(/資料更新至 2026-07-22/)).toBeInTheDocument();
});

it("期間切換連結帶 scroll={false}（不跳頁）", () => {
  render(<TodayOverviewDashboard overview={vm({
    rangeOptions: [
      { value: "day", label: "當日", href: "/?range=day", active: true },
      { value: "week", label: "本週", href: "/?range=week", active: false },
    ],
  })} />);
  // next/link 的 scroll={false} 會轉成 DOM 屬性由測試驗；改以 data 屬性標記確保可測
  expect(screen.getByTestId("range-link-week")).toHaveAttribute("data-scroll", "false");
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- components/today-overview-dashboard.test.tsx`
Expected: FAIL — 無更新時間文字、無 `range-link-week` testid

- [ ] **Step 3: 實作更新時間**

`web/components/today-overview-dashboard.tsx`，在 header 區塊（原 line 286-288 的說明 `<p>` 之後）加一行：

```tsx
{overview.availableDates[0] ? (
  <p className="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
    資料更新至 {overview.availableDates[0]}
  </p>
) : null}
```

- [ ] **Step 4: 實作 scroll={false} + testid**

把 `CollectiveMovements` 內期間選項的 `<Link>`（原 line 168-180）改為帶 `scroll={false}` 與可測 data 屬性：

```tsx
<Link
  key={option.value}
  href={option.href}
  scroll={false}
  data-testid={`range-link-${option.value}`}
  data-scroll="false"
  className={cn(
    "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
    option.active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
  )}
>
  {option.label}
</Link>
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npm test -- components/today-overview-dashboard.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/today-overview-dashboard.tsx components/today-overview-dashboard.test.tsx
git commit -m "feat: 上方資料更新時間標示與期間切換不跳頁"
```

---

### Task 9: 端到端驗證

**Files:** 無（驗證步驟）

- [ ] **Step 1: 全套測試 + 建置**

Run（`web/` 下）: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: 全 PASS、build 成功、`/` 為 dynamic

- [ ] **Step 2: dev server 真資料 smoke**

Run: `npm run dev`，用瀏覽器工具或 curl 核對：
1. 首頁上方顯示「資料更新至 {最新交易日}」
2. 集體動向切 當日/本週/上週/本月/上月，畫面不跳回頂、內容更新；上週/上月能顯示前一期資料
3. 異動牆：預設「建倉出清 × 台股」；切「加減碼」「海外」即時換；超過 5 筆出現「查看更多（N）」，點開展開、可收合；N/E/A/T 圖例與說明文字在
4. 挑一個有海外持股的交易日，確認異動牆/雷達/集體動向的海外股顯示為 `MRVL US`（不重複）
5. 全站權重變化為 `+0.05%` 格式（無 `pp`）
6. 手機 375px：異動牆切換列與表格不橫向溢出

- [ ] **Step 3: 提交 PR（依 agent-workflow 正式版流程）**

依 `docs/superpowers/process/agent-workflow.md`：Generator 開 PR（純前端、無 DB，整合測試不涉真 DB），PR body 含變更摘要、驗證輸出、真資料 smoke 證據、已知風險。交獨立 Evaluator review。

---

## Self-Review 紀錄

- **Spec 覆蓋**：§3.1 期間擴充=Task 4；§3.2 更新時間=Task 8；§3.3 不跳頁=Task 8；§4 海外去重複（helper=Task 2、市場判別=Task 1、全站套用=Task 6）；§5 異動牆（純邏輯=Task 5、元件含頁籤/市場/查看更多/說明/圖例=Task 7）；§6 pp→%=Task 3；§7 檔案影響對應各 Task；§8 測試分散各 Task + Task 9。
- **無 placeholder**：所有步驟含完整程式碼與預期輸出；Task 6 Step 1 的 grep 是定位手段，後續替換規則明確（只改代號+名稱並排、ETF 名稱不動）。
- **型別一致**：`OverviewRange`（Task 4）5 值於 data 層與 buildRangeOptions 一致；`ChangeWallTab`/`MarketFilter`（Task 5）於 Task 7 元件引用相同名稱；`stockMarket`（Task 1）於 Task 5 `filterChangeWall` 引用；`formatStockLabel`（Task 2）於 Task 6/7 引用；`formatWeightDelta`（Task 3 改 %）於 Task 7 元件沿用。
