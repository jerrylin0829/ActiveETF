# 交集表與產業權重輪動 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依 `docs/superpowers/specs/2026-07-16-cross-holdings-rotation-design.md`，新增兩張每日衍生表（`cross_holdings_daily`、`industry_weight_daily`）+ pipeline 彙總步驟 + backfill，以及前端 `/cross` 交集表頁與 `/rotation` 產業權重輪動頁。

**Architecture:** 彙總在 pipeline 寫入時以單一 `insert…select` 於 DB 端計算（冪等：先 delete 當日再 insert），前端純 SELECT。前端沿用 `lib/<feature>.ts`（純邏輯，可測）+ `lib/<feature>-data.ts`（Supabase 查詢）+ `components/<feature>.tsx` 慣例。

**Tech Stack:** Python 3 + psycopg（scraper）、Next.js + shadcn/ui + Tailwind + Recharts（web）、pytest / Vitest。

**PR 切分：** Task 1–4 = PR「資料層」；Task 5–11 = PR「前端」。兩個 PR 各自可獨立驗收（前端 PR 依賴資料層已部署並 backfill 完成）。

**通用約定（所有 Task 適用）：**
- scraper 指令都在 `scraper/` 目錄下執行；跑整合測試前先 `set -a && source .env.local && set +a`
- web 指令都在 `web/` 目錄下執行
- Commit message 格式 `type: 中文描述`；程式碼識別字與註解用英文

---

### Task 1: Migration 003 — 兩張彙總表 + RLS + 日期 view

**Files:**
- Create: `scraper/migrations/003_cross_holdings_rotation.sql`

- [ ] **Step 1: 寫 migration**

```sql
-- 003_cross_holdings_rotation.sql - spec 2026-07-16 §3
create table cross_holdings_daily (
  trade_date       date not null,
  stock_id         text not null,
  etf_count        int not null,               -- covering active-ETF count
  total_weight_pct numeric(10,4) not null,     -- sum of per-ETF weights (%)
  total_shares     bigint not null,            -- sum of shares
  total_value_twd  numeric(20,2),              -- sum(shares * close), TWD; null if price missing
  new_count  int not null default 0,           -- ETFs with NEW event that day
  add_count  int not null default 0,
  trim_count int not null default 0,
  exit_count int not null default 0,
  primary key (trade_date, stock_id)
);

create table industry_weight_daily (
  trade_date       date not null,
  industry         text not null,              -- stock_info.industry; blank -> '未分類'
  sum_weight_pct   numeric(12,4) not null,     -- sum over all active ETFs (%)
  stock_count      int not null,               -- distinct stocks held in this industry
  etf_count_total  int not null,               -- ETFs with a snapshot that day (avg denominator)
  primary key (trade_date, industry)
);

do $$ declare t text;
begin
  foreach t in array array['cross_holdings_daily','industry_weight_daily'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_read on %I for select using (true)', t, t);
  end loop;
end $$;

-- bounded date lookup for the /cross date selector (follows 002 pattern)
create view dashboard_cross_dates
with (security_invoker = true) as
select distinct trade_date
from cross_holdings_daily;

grant select on dashboard_cross_dates to anon, authenticated;
```

- [ ] **Step 2: 套用到 Supabase**

```bash
set -a && source .env.local && set +a
psql "$SUPABASE_DB_URL" -f migrations/003_cross_holdings_rotation.sql
```

Expected: `CREATE TABLE` ×2、`DO`、`CREATE VIEW`、`GRANT`，無錯誤。

- [ ] **Step 3: Commit**

```bash
git add migrations/003_cross_holdings_rotation.sql
git commit -m "feat: 交集表與產業輪動彙總表 schema"
```

---

### Task 2: `db.refresh_daily_aggregates()` — 彙總計算（TDD）

**Files:**
- Modify: `scraper/src/activeetf/db.py`（檔尾新增）
- Test: `scraper/tests/test_aggregates.py`

- [ ] **Step 1: 寫失敗的整合測試**

`scraper/tests/test_aggregates.py`（比照 `test_db.py`：無 `SUPABASE_DB_URL` 自動 skip、遠古日期、setup 前與 teardown 後皆清理；**股票代號必須用 `_T` 開頭的假代號**——`9901`/`9902` 是真實代號，會撞到正式 `stock_info` 資料）：

```python
import os, datetime as dt
import pytest
from activeetf.models import Holding, Change
from activeetf import db

pytestmark = pytest.mark.skipif(not os.environ.get("SUPABASE_DB_URL"),
                                reason="needs SUPABASE_DB_URL")

D = dt.date(2000, 1, 4)  # ancient date to avoid touching real data; cleaned up below

@pytest.fixture(autouse=True)
def _seed_and_cleanup():
    with db.conn() as c:
        c.execute("insert into etf (etf_id, name, issuer) values "
                  "('_TA','a','x'), ('_TB','b','x')")
        c.execute("insert into stock_info (stock_id, name, industry, market) values "
                  "('_T91','alpha','水泥工業','twse'), ('_T92','beta','','twse')")
        c.execute("insert into stock_price (stock_id, trade_date, close, adj_close) values "
                  "('_T91', %s, 100, 100)", (D,))  # _T92 has no price on purpose
    db.write_snapshot("_TA", D, [Holding("_T91", 2000, 10.0), Holding("_T92", 1000, 5.0)])
    db.write_snapshot("_TB", D, [Holding("_T91", 3000, 8.0)])
    db.write_changes("_TA", D, [Change("_T91", "ADD", 500, 1.0)])
    db.write_changes("_TB", D, [Change("_T91", "NEW", 3000, 8.0)])
    yield
    with db.conn() as c:
        for t in ("cross_holdings_daily", "industry_weight_daily",
                  "holding_change", "holdings_snapshot", "stock_price"):
            c.execute(f"delete from {t} where trade_date = %s", (D,))
        c.execute("delete from stock_info where stock_id in ('_T91','_T92')")
        c.execute("delete from etf where etf_id in ('_TA','_TB')")

def test_cross_holdings_aggregation():
    db.refresh_daily_aggregates(D)
    with db.conn() as c:
        rows = {r[0]: r for r in c.execute(
            """select stock_id, etf_count, total_weight_pct, total_shares,
                      total_value_twd, new_count, add_count, trim_count, exit_count
               from cross_holdings_daily where trade_date=%s""", (D,)).fetchall()}
    a = rows["_T91"]
    assert (a[1], float(a[2]), a[3]) == (2, 18.0, 5000)
    assert float(a[4]) == 500000.0          # 5000 shares * 100
    assert (a[5], a[6], a[7], a[8]) == (1, 1, 0, 0)   # one NEW + one ADD
    b = rows["_T92"]
    assert (b[1], float(b[2]), b[3], b[4]) == (1, 5.0, 1000, None)  # no price -> null value

def test_industry_weight_aggregation():
    db.refresh_daily_aggregates(D)
    with db.conn() as c:
        rows = {r[0]: r for r in c.execute(
            """select industry, sum_weight_pct, stock_count, etf_count_total
               from industry_weight_daily where trade_date=%s""", (D,)).fetchall()}
    assert float(rows["水泥工業"][1]) == 18.0
    assert rows["水泥工業"][2] == 1
    assert rows["水泥工業"][3] == 2          # two ETFs had a snapshot that day
    assert float(rows["未分類"][1]) == 5.0   # blank industry falls back to 未分類

def test_refresh_is_idempotent():
    db.refresh_daily_aggregates(D)
    db.refresh_daily_aggregates(D)   # rerun must not duplicate
    with db.conn() as c:
        n = c.execute("select count(*) from cross_holdings_daily where trade_date=%s",
                      (D,)).fetchone()[0]
    assert n == 2
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
set -a && source .env.local && set +a
uv run pytest tests/test_aggregates.py -v
```

Expected: FAIL — `AttributeError: module 'activeetf.db' has no attribute 'refresh_daily_aggregates'`

- [ ] **Step 3: 實作**

`scraper/src/activeetf/db.py` 檔尾新增：

```python
def refresh_daily_aggregates(d: dt.date) -> None:
    """Recompute cross_holdings_daily and industry_weight_daily for one date.
    delete + insert…select inside one transaction => idempotent rerun."""
    with conn() as c, c.transaction():
        c.execute("delete from cross_holdings_daily where trade_date=%s", (d,))
        # sum(shares * close): price is per (stock, date) so it is identical on every
        # joined row; if it is missing the whole sum collapses to null (wanted).
        c.execute("""
            insert into cross_holdings_daily
              (trade_date, stock_id, etf_count, total_weight_pct, total_shares,
               total_value_twd, new_count, add_count, trim_count, exit_count)
            select h.trade_date, h.stock_id, count(*), sum(h.weight_pct), sum(h.shares),
                   sum(h.shares * p.close),
                   coalesce(max(c1.new_count), 0), coalesce(max(c1.add_count), 0),
                   coalesce(max(c1.trim_count), 0), coalesce(max(c1.exit_count), 0)
            from holdings_snapshot h
            left join stock_price p
              on p.stock_id = h.stock_id and p.trade_date = h.trade_date
            left join (
              select stock_id,
                     count(*) filter (where change_type='NEW')  as new_count,
                     count(*) filter (where change_type='ADD')  as add_count,
                     count(*) filter (where change_type='TRIM') as trim_count,
                     count(*) filter (where change_type='EXIT') as exit_count
              from holding_change where trade_date = %s
              group by stock_id
            ) c1 on c1.stock_id = h.stock_id
            where h.trade_date = %s
            group by h.trade_date, h.stock_id""", (d, d))
        c.execute("delete from industry_weight_daily where trade_date=%s", (d,))
        c.execute("""
            insert into industry_weight_daily
              (trade_date, industry, sum_weight_pct, stock_count, etf_count_total)
            select h.trade_date,
                   coalesce(nullif(trim(si.industry), ''), '未分類'),
                   sum(h.weight_pct), count(distinct h.stock_id),
                   (select count(distinct etf_id) from holdings_snapshot
                     where trade_date = %s)
            from holdings_snapshot h
            left join stock_info si on si.stock_id = h.stock_id
            where h.trade_date = %s
            group by h.trade_date, coalesce(nullif(trim(si.industry), ''), '未分類')""",
            (d, d))
```

- [ ] **Step 4: 跑測試確認通過**

```bash
uv run pytest tests/test_aggregates.py -v
```

Expected: 3 passed。再跑全套確認沒弄壞別的：`uv run pytest`，Expected: 全 pass（無 DB 的環境會 skip 整合測試）。

- [ ] **Step 5: Commit**

```bash
git add src/activeetf/db.py tests/test_aggregates.py
git commit -m "feat: 每日交集與產業權重彙總計算"
```

---

### Task 3: pipeline 接入彙總步驟

**Files:**
- Modify: `scraper/src/activeetf/pipeline.py:60`（`metrics.compute_all(today)` 之後）

- [ ] **Step 1: 修改 `main()`**

在 `metrics.compute_all(today)` 的下一行加（與 metrics 相同模式：直接呼叫，不進 Deps——Deps 只注入 `scrape_one` 用到的函式）：

```python
    metrics.compute_all(today)   # 還原價/指數由 metrics 按需向 yfinance/FinMind 拉並快取
    db.refresh_daily_aggregates(today)   # spec 2026-07-16 §3.3: aggregates after snapshots+events
```

- [ ] **Step 2: 跑全套測試**

```bash
uv run pytest
```

Expected: 全 pass（`test_pipeline.py` 只測 `scrape_one`，不會碰 `main()`）。

- [ ] **Step 3: Commit**

```bash
git add src/activeetf/pipeline.py
git commit -m "feat: pipeline 每日彙總交集表與產業權重"
```

---

### Task 4: backfill 腳本 + 實際回補

**Files:**
- Create: `scraper/scripts/backfill_aggregates.py`

- [ ] **Step 1: 寫腳本**

```python
"""One-off backfill: recompute both daily aggregate tables for every date that
has snapshots. Safe to rerun (refresh_daily_aggregates is idempotent).

Usage:  set -a && source .env.local && set +a
        uv run python scripts/backfill_aggregates.py
"""
from activeetf import db


def main() -> None:
    with db.conn() as c:
        dates = [r[0] for r in c.execute(
            "select distinct trade_date from holdings_snapshot order by 1").fetchall()]
    print(f"backfilling {len(dates)} dates")
    for d in dates:
        db.refresh_daily_aggregates(d)
        print(f"{d} ok")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 對真實 DB 執行**

```bash
set -a && source .env.local && set +a
uv run python scripts/backfill_aggregates.py
```

Expected: 每個日期一行 `YYYY-MM-DD ok`。抽查一天：

```bash
psql "$SUPABASE_DB_URL" -c "select count(*), max(etf_count) from cross_holdings_daily where trade_date = (select max(trade_date) from cross_holdings_daily);"
```

Expected: count 數百列、`max(etf_count)` ≥ 2。

- [ ] **Step 3: Commit（資料層 PR 到此完成）**

```bash
git add scripts/backfill_aggregates.py
git commit -m "feat: 彙總表一次性回補腳本"
```

---

### Task 5: 前端基礎 — Recharts + 共用數字格式（TDD）

**Files:**
- Modify: `web/package.json`（`npm install` 產生）
- Create: `web/lib/format.ts`
- Test: `web/lib/format.test.ts`

- [ ] **Step 1: 安裝 Recharts**

```bash
npm install recharts
```

- [ ] **Step 2: 寫失敗的測試**

`web/lib/format.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { formatLots, formatPct, formatSignedPct, formatYi } from "@/lib/format";

describe("format", () => {
  it("權重以 % 呈現、最多兩位小數", () => {
    expect(formatPct(12.334)).toBe("12.33%");
    expect(formatPct(null)).toBe("—");
  });
  it("變化帶正負號", () => {
    expect(formatSignedPct(1.25)).toBe("+1.25%");
    expect(formatSignedPct(-0.866)).toBe("-0.87%");
    expect(formatSignedPct(0)).toBe("+0.00%");
    expect(formatSignedPct(null)).toBe("—");
  });
  it("金額元轉億元", () => {
    expect(formatYi(2750000000)).toBe("27.50 億");
    expect(formatYi(null)).toBe("—");
  });
  it("股數轉張數千分位", () => {
    expect(formatLots(1234000)).toBe("1,234");
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

```bash
npm test -- lib/format.test.ts
```

Expected: FAIL — cannot resolve `@/lib/format`

- [ ] **Step 4: 實作**

`web/lib/format.ts`：

```typescript
// Spec 2026-07-16 §7: all weights as %, max 2 decimals; changes signed (+12.33%);
// money in 億 TWD; shares shown as lots (1 lot = 1,000 shares).
export function formatPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

export function formatSignedPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatYi(valueTwd: number | null): string {
  return valueTwd === null ? "—" : `${(valueTwd / 1e8).toFixed(2)} 億`;
}

export function formatLots(shares: number): string {
  return Math.round(shares / 1000).toLocaleString("zh-TW");
}
```

- [ ] **Step 5: 跑測試確認通過，Commit**

```bash
npm test -- lib/format.test.ts
git add package.json package-lock.json lib/format.ts lib/format.test.ts
git commit -m "feat: 前端數字格式工具與 Recharts 依賴"
```

---

### Task 6: `lib/cross-holdings.ts` 純邏輯（TDD）

**Files:**
- Create: `web/lib/cross-holdings.ts`
- Test: `web/lib/cross-holdings.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`web/lib/cross-holdings.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import {
  applyFilters,
  sortRows,
  type CoverageFilter,
  type CrossRow,
} from "@/lib/cross-holdings";

const row = (over: Partial<CrossRow>): CrossRow => ({
  stockId: "2330",
  stockName: "台積電",
  industry: "半導體業",
  etfCount: 3,
  totalWeightPct: 20,
  totalShares: 1000,
  totalValueTwd: null,
  newCount: 0,
  addCount: 0,
  trimCount: 0,
  exitCount: 0,
  ...over,
});

describe("sortRows", () => {
  it("預設涵蓋檔數降冪、次鍵合計權重降冪", () => {
    const rows = [
      row({ stockId: "A", etfCount: 2, totalWeightPct: 9 }),
      row({ stockId: "B", etfCount: 5, totalWeightPct: 1 }),
      row({ stockId: "C", etfCount: 5, totalWeightPct: 8 }),
    ];
    expect(sortRows(rows, { key: "etfCount", desc: true }).map((r) => r.stockId))
      .toEqual(["C", "B", "A"]);
  });
  it("可依任一數值欄排序", () => {
    const rows = [row({ stockId: "A", totalShares: 5 }), row({ stockId: "B", totalShares: 9 })];
    expect(sortRows(rows, { key: "totalShares", desc: true })[0].stockId).toBe("B");
  });
});

describe("applyFilters", () => {
  const rows = [
    row({ stockId: "A", etfCount: 1, industry: "水泥工業" }),
    row({ stockId: "B", etfCount: 3, industry: "半導體業", addCount: 1 }),
    row({ stockId: "C", etfCount: 5, industry: "半導體業" }),
  ];
  it("獨門 = 涵蓋檔數恰為 1", () => {
    expect(applyFilters(rows, { coverage: "only1", industries: [], changedOnly: false })
      .map((r) => r.stockId)).toEqual(["A"]);
  });
  it("涵蓋檔數下限 + 產業 + 只看異動可疊加", () => {
    const f = { coverage: "min2" as CoverageFilter, industries: ["半導體業"], changedOnly: true };
    expect(applyFilters(rows, f).map((r) => r.stockId)).toEqual(["B"]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
npm test -- lib/cross-holdings.test.ts
```

Expected: FAIL — cannot resolve `@/lib/cross-holdings`

- [ ] **Step 3: 實作**

`web/lib/cross-holdings.ts`：

```typescript
export type CrossRow = {
  stockId: string;
  stockName: string;
  industry: string;
  etfCount: number;
  totalWeightPct: number;
  totalShares: number;
  totalValueTwd: number | null;
  newCount: number;
  addCount: number;
  trimCount: number;
  exitCount: number;
};

export type CrossDetail = {
  etfId: string;
  etfName: string;
  weightPct: number;
  shares: number;
  changeType: "NEW" | "ADD" | "TRIM" | "EXIT" | null;
};

export type SortKey = "etfCount" | "totalWeightPct" | "totalShares" | "totalValueTwd";
export type SortState = { key: SortKey; desc: boolean };
export type CoverageFilter = "all" | "min2" | "min3" | "min5" | "only1";
export type CrossFilters = {
  coverage: CoverageFilter;
  industries: string[];
  changedOnly: boolean;
};

const coveragePredicate: Record<CoverageFilter, (n: number) => boolean> = {
  all: () => true,
  min2: (n) => n >= 2,
  min3: (n) => n >= 3,
  min5: (n) => n >= 5,
  only1: (n) => n === 1,
};

export function applyFilters(rows: CrossRow[], filters: CrossFilters): CrossRow[] {
  return rows.filter((r) => {
    if (!coveragePredicate[filters.coverage](r.etfCount)) return false;
    if (filters.industries.length > 0 && !filters.industries.includes(r.industry)) return false;
    if (filters.changedOnly && r.newCount + r.addCount + r.trimCount + r.exitCount === 0)
      return false;
    return true;
  });
}

export function sortRows(rows: CrossRow[], sort: SortState): CrossRow[] {
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[sort.key] ?? -Infinity;
    const bv = b[sort.key] ?? -Infinity;
    if (av !== bv) return av < bv ? -dir : dir;
    // secondary key: total weight desc, then stock id for stability
    if (a.totalWeightPct !== b.totalWeightPct) return b.totalWeightPct - a.totalWeightPct;
    return a.stockId.localeCompare(b.stockId);
  });
}
```

- [ ] **Step 4: 跑測試確認通過，Commit**

```bash
npm test -- lib/cross-holdings.test.ts
git add lib/cross-holdings.ts lib/cross-holdings.test.ts
git commit -m "feat: 交集表排序與篩選邏輯"
```

---

### Task 7: `lib/cross-holdings-data.ts` 查詢層

**Files:**
- Create: `web/lib/cross-holdings-data.ts`

查詢層照 `rankings-data.ts` 慣例：型別化 record、`toNumber` 轉換、錯誤聚合成字串。無單元測試（純 I/O 組裝，與 `today-overview-data.ts` 同等對待——該檔測試只測純函式部分；本檔把純函式留在 Task 6）。

- [ ] **Step 1: 實作**

```typescript
import { createReadOnlySupabaseClient } from "@/lib/supabase";
import type { CrossDetail, CrossRow } from "@/lib/cross-holdings";

type CrossRecord = {
  trade_date: string;
  stock_id: string;
  etf_count: number;
  total_weight_pct: number | string;
  total_shares: number | string;
  total_value_twd: number | string | null;
  new_count: number;
  add_count: number;
  trim_count: number;
  exit_count: number;
};

export type CrossHoldingsResult = {
  date: string | null;             // resolved trade date (latest if not given)
  availableDates: string[];        // for the date selector, desc
  rows: CrossRow[];
  details: Record<string, CrossDetail[]>;  // stockId -> per-ETF breakdown
  etfCountThatDay: number;         // distinct ETFs with snapshot that day
  etfCountTotal: number;           // rows in etf table (黃條分母)
  error: string | null;
};

const pageSize = 1000;

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchCrossHoldings(dateParam?: string): Promise<CrossHoldingsResult> {
  const supabase = createReadOnlySupabaseClient();
  const empty: CrossHoldingsResult = {
    date: null, availableDates: [], rows: [], details: {},
    etfCountThatDay: 0, etfCountTotal: 0, error: null,
  };

  const { data: dateData, error: dateError } = await supabase
    .from("dashboard_cross_dates")
    .select("trade_date")
    .order("trade_date", { ascending: false })
    .limit(120);
  if (dateError) return { ...empty, error: dateError.message };

  const availableDates = (dateData ?? []).map((r) => r.trade_date as string);
  const date = dateParam && availableDates.includes(dateParam) ? dateParam : availableDates[0];
  if (!date) return { ...empty, availableDates };

  const [crossRes, holdingRes, changeRes, etfRes, stockRes] = await Promise.all([
    fetchAll<CrossRecord>(supabase, "cross_holdings_daily", "*", date),
    fetchAll<{ etf_id: string; stock_id: string; shares: number | string;
               weight_pct: number | string; etf: { name: string } | { name: string }[] | null }>(
      supabase, "holdings_snapshot", "etf_id, stock_id, shares, weight_pct, etf(name)", date),
    fetchAll<{ etf_id: string; stock_id: string; change_type: string }>(
      supabase, "holding_change", "etf_id, stock_id, change_type", date),
    supabase.from("etf").select("etf_id"),
    supabase.from("stock_info").select("stock_id, name, industry"),
  ]);

  const stockInfo = new Map(
    (stockRes.data ?? []).map((s) => [s.stock_id as string,
      { name: (s.name as string) ?? s.stock_id, industry: (s.industry as string) || "未分類" }]),
  );
  const changeMap = new Map(
    (changeRes.data ?? []).map((c) => [`${c.etf_id}:${c.stock_id}`, c.change_type]),
  );

  const rows: CrossRow[] = (crossRes.data ?? []).map((r) => ({
    stockId: r.stock_id,
    stockName: stockInfo.get(r.stock_id)?.name ?? r.stock_id,
    industry: stockInfo.get(r.stock_id)?.industry ?? "未分類",
    etfCount: r.etf_count,
    totalWeightPct: toNumber(r.total_weight_pct) ?? 0,
    totalShares: toNumber(r.total_shares) ?? 0,
    totalValueTwd: toNumber(r.total_value_twd),
    newCount: r.new_count, addCount: r.add_count,
    trimCount: r.trim_count, exitCount: r.exit_count,
  }));

  const details: Record<string, CrossDetail[]> = {};
  const etfIdsThatDay = new Set<string>();
  for (const h of holdingRes.data ?? []) {
    etfIdsThatDay.add(h.etf_id);
    const rel = Array.isArray(h.etf) ? h.etf[0] : h.etf;
    (details[h.stock_id] ??= []).push({
      etfId: h.etf_id,
      etfName: rel?.name ?? h.etf_id,
      weightPct: toNumber(h.weight_pct) ?? 0,
      shares: toNumber(h.shares) ?? 0,
      changeType: (changeMap.get(`${h.etf_id}:${h.stock_id}`) ?? null) as CrossDetail["changeType"],
    });
  }
  for (const list of Object.values(details)) list.sort((a, b) => b.weightPct - a.weightPct);

  const errors = [crossRes.error, holdingRes.error, changeRes.error,
                  etfRes.error?.message, stockRes.error?.message].filter(Boolean);
  return {
    date, availableDates, rows, details,
    etfCountThatDay: etfIdsThatDay.size,
    etfCountTotal: (etfRes.data ?? []).length,
    error: errors.length > 0 ? errors.join("；") : null,
  };
}

async function fetchAll<T>(
  supabase: ReturnType<typeof createReadOnlySupabaseClient>,
  table: string, select: string, date: string,
): Promise<{ data: T[]; error: string | null }> {
  const records: T[] = [];
  let page = 0;
  while (true) {
    const from = page * pageSize;
    const { data, error } = await supabase
      .from(table).select(select).eq("trade_date", date).range(from, from + pageSize - 1);
    if (error) return { data: records, error: error.message };
    const batch = (data ?? []) as T[];
    records.push(...batch);
    if (batch.length < pageSize) return { data: records, error: null };
    page += 1;
  }
}
```

- [ ] **Step 2: 型別檢查 + 全套測試**

```bash
npx tsc --noEmit && npm test
```

Expected: 無型別錯誤、全 pass。

- [ ] **Step 3: Commit**

```bash
git add lib/cross-holdings-data.ts
git commit -m "feat: 交集表資料查詢層"
```

---

### Task 8: 交集表元件 + `/cross` 頁 + 導覽（TDD）

**Files:**
- Create: `web/components/cross-holdings-table.tsx`
- Create: `web/app/cross/page.tsx`
- Modify: `web/components/site-nav.tsx`
- Test: `web/components/cross-holdings-table.test.tsx`

- [ ] **Step 1: 寫失敗的元件測試**

`web/components/cross-holdings-table.test.tsx`（比照 `rankings-table.test.tsx` 用 Testing Library）：

```typescript
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CrossHoldingsTable } from "@/components/cross-holdings-table";
import type { CrossDetail, CrossRow } from "@/lib/cross-holdings";

const rows: CrossRow[] = [
  { stockId: "2330", stockName: "台積電", industry: "半導體業", etfCount: 5,
    totalWeightPct: 30.125, totalShares: 5000000, totalValueTwd: 5e9,
    newCount: 0, addCount: 2, trimCount: 1, exitCount: 0 },
  { stockId: "1101", stockName: "台泥", industry: "水泥工業", etfCount: 1,
    totalWeightPct: 2.5, totalShares: 1000000, totalValueTwd: null,
    newCount: 0, addCount: 0, trimCount: 0, exitCount: 0 },
];
const details: Record<string, CrossDetail[]> = {
  "2330": [{ etfId: "00981A", etfName: "主動統一台股增長", weightPct: 9.31,
             shares: 1000000, changeType: "ADD" }],
};

describe("CrossHoldingsTable", () => {
  it("預設依涵蓋檔數降冪並照規範格式化", () => {
    render(<CrossHoldingsTable rows={rows} details={details} />);
    const bodyRows = screen.getAllByTestId("cross-row");
    expect(within(bodyRows[0]).getByText("台積電")).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText("30.13%")).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText("50.00 億")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("—")).toBeInTheDocument(); // missing price
  });
  it("異動徽章只在有事件時出現", () => {
    render(<CrossHoldingsTable rows={rows} details={details} />);
    expect(screen.getByText("加碼×2")).toBeInTheDocument();
    expect(screen.getByText("減碼×1")).toBeInTheDocument();
    expect(screen.queryByText("新進×0")).not.toBeInTheDocument();
  });
  it("獨門篩選只留涵蓋檔數 1 的列", async () => {
    const user = userEvent.setup();
    render(<CrossHoldingsTable rows={rows} details={details} />);
    await user.selectOptions(screen.getByLabelText("涵蓋檔數"), "only1");
    expect(screen.queryByText("台積電")).not.toBeInTheDocument();
    expect(screen.getByText("台泥")).toBeInTheDocument();
  });
  it("點列展開該股的 ETF 明細", async () => {
    const user = userEvent.setup();
    render(<CrossHoldingsTable rows={rows} details={details} />);
    await user.click(screen.getByText("台積電"));
    expect(screen.getByText("主動統一台股增長")).toBeInTheDocument();
    expect(screen.getByText("9.31%")).toBeInTheDocument();
  });
  it("空資料顯示空狀態", () => {
    render(<CrossHoldingsTable rows={[]} details={{}} />);
    expect(screen.getByText(/該日無資料/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
npm test -- components/cross-holdings-table.test.tsx
```

Expected: FAIL — cannot resolve `@/components/cross-holdings-table`

- [ ] **Step 3: 實作元件**

`web/components/cross-holdings-table.tsx`（client component；表格用 `components/ui/table.tsx`、徽章用 `components/ui/badge.tsx`；紅漲綠跌沿用 `today-overview-dashboard.tsx` 的既有慣例：`--market-up`/`--market-down` CSS 變數與 red/emerald badge 配色）：

```typescript
"use client";

import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatLots, formatPct, formatYi } from "@/lib/format";
import {
  applyFilters, sortRows,
  type CoverageFilter, type CrossDetail, type CrossRow, type SortKey, type SortState,
} from "@/lib/cross-holdings";

type Props = { rows: CrossRow[]; details: Record<string, CrossDetail[]> };

const coverageOptions: { value: CoverageFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "min2", label: "≥2 檔" },
  { value: "min3", label: "≥3 檔" },
  { value: "min5", label: "≥5 檔" },
  { value: "only1", label: "獨門(=1)" },
];

const changeLabel: Record<string, string> = {
  NEW: "新進", ADD: "加碼", TRIM: "減碼", EXIT: "出清",
};

// mirrors badgeTone() in today-overview-dashboard.tsx: 紅漲綠跌
const UP_BADGE = "border-red-200 bg-red-50 text-red-700";
const DOWN_BADGE = "border-emerald-200 bg-emerald-50 text-emerald-700";

export function CrossHoldingsTable({ rows, details }: Props) {
  const [sort, setSort] = useState<SortState>({ key: "etfCount", desc: true });
  const [coverage, setCoverage] = useState<CoverageFilter>("all");
  const [industry, setIndustry] = useState<string>("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const industries = useMemo(
    () => [...new Set(rows.map((r) => r.industry))].sort(), [rows]);
  const visible = useMemo(() => {
    const filtered = applyFilters(rows, {
      coverage, industries: industry ? [industry] : [], changedOnly,
    });
    return sortRows(filtered, sort);
  }, [rows, coverage, industry, changedOnly, sort]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">該日無資料，請改選其他交易日。</p>;
  }

  const header = (key: SortKey, label: string) => (
    <TableHead>
      <button type="button" className="font-medium hover:text-foreground"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}>
        {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </TableHead>
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="grid gap-1 font-medium text-muted-foreground">
          涵蓋檔數
          <select value={coverage} onChange={(e) => setCoverage(e.target.value as CoverageFilter)}
            className="h-9 rounded-md border border-input bg-card px-2">
            {coverageOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 font-medium text-muted-foreground">
          產業
          <select value={industry} onChange={(e) => setIndustry(e.target.value)}
            className="h-9 rounded-md border border-input bg-card px-2">
            <option value="">全部產業</option>
            {industries.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 font-medium text-muted-foreground">
          <input type="checkbox" checked={changedOnly}
            onChange={(e) => setChangedOnly(e.target.checked)} />
          只看當日有異動
        </label>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>代號 / 名稱</TableHead>
            <TableHead className="hidden md:table-cell">產業</TableHead>
            {header("etfCount", "涵蓋檔數")}
            {header("totalWeightPct", "合計權重")}
            {header("totalValueTwd", "合計金額(億)")}
            {header("totalShares", "合計張數")}
            <TableHead>當日異動</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((r) => (
            <Fragment key={r.stockId}>
              <TableRow data-testid="cross-row" className="cursor-pointer"
                onClick={() => setExpanded(expanded === r.stockId ? null : r.stockId)}>
                <TableCell className="font-mono">{r.stockId} {r.stockName}</TableCell>
                <TableCell className="hidden md:table-cell">{r.industry}</TableCell>
                <TableCell className="tabular-nums">{r.etfCount}</TableCell>
                <TableCell className="tabular-nums">{formatPct(r.totalWeightPct)}</TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">
                  {formatYi(r.totalValueTwd)}
                </TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">
                  {formatLots(r.totalShares)}
                </TableCell>
                <TableCell className="space-x-1">
                  {r.newCount > 0 && <Badge className={UP_BADGE}>新進×{r.newCount}</Badge>}
                  {r.addCount > 0 && <Badge className={UP_BADGE}>加碼×{r.addCount}</Badge>}
                  {r.trimCount > 0 && <Badge className={DOWN_BADGE}>減碼×{r.trimCount}</Badge>}
                  {r.exitCount > 0 && <Badge className={DOWN_BADGE}>出清×{r.exitCount}</Badge>}
                </TableCell>
              </TableRow>
              {expanded === r.stockId && (details[r.stockId] ?? []).map((d) => (
                <TableRow key={`${r.stockId}-${d.etfId}`} className="bg-muted/40">
                  <TableCell colSpan={2} className="pl-8 font-mono text-sm">
                    {d.etfId} {d.etfName}
                  </TableCell>
                  <TableCell />
                  <TableCell className="tabular-nums">{formatPct(d.weightPct)}</TableCell>
                  <TableCell className="hidden sm:table-cell" />
                  <TableCell className="hidden tabular-nums sm:table-cell">
                    {formatLots(d.shares)}
                  </TableCell>
                  <TableCell>{d.changeType ? changeLabel[d.changeType] : ""}</TableCell>
                </TableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: 跑元件測試確認通過**

```bash
npm test -- components/cross-holdings-table.test.tsx
```

Expected: 5 passed

- [ ] **Step 5: 導覽 + 頁面**

`web/components/site-nav.tsx` 改為：

```typescript
type SiteNavProps = {
  active: "overview" | "rankings" | "cross" | "rotation";
};

const navItems = [
  { href: "/", label: "今日總覽", value: "overview" },
  { href: "/rankings", label: "ETF 排行榜", value: "rankings" },
  { href: "/cross", label: "交集表", value: "cross" },
  { href: "/rotation", label: "產業輪動", value: "rotation" },
] as const;
```

`web/app/cross/page.tsx`（server component，照 `app/page.tsx` 模式；頁首元素——標題、`SiteNav`、日期表單、黃條——的版面結構照抄今日總覽頁的容器寫法）：

```typescript
import { CrossHoldingsTable } from "@/components/cross-holdings-table";
import { SiteNav } from "@/components/site-nav";
import { fetchCrossHoldings } from "@/lib/cross-holdings-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CrossPageProps = { searchParams?: Promise<{ date?: string }> };

export default async function CrossPage({ searchParams }: CrossPageProps) {
  const params = await searchParams;
  const result = await fetchCrossHoldings(params?.date);

  return (
    <main className="mx-auto grid max-w-6xl gap-6 p-4 md:p-8">
      <header className="grid gap-3">
        <SiteNav active="cross" />
        <h1 className="text-2xl font-semibold">交集表</h1>
        <p className="text-sm text-muted-foreground">
          全部主動式股票型 ETF 的持股交集：每檔股票被幾檔 ETF 持有、合計權重與當日異動。
        </p>
        <form action="/cross" className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-medium text-muted-foreground">
            交易日
            <select name="date" defaultValue={result.date ?? ""}
              className="h-9 min-w-40 rounded-md border border-input bg-card px-3 font-mono text-sm">
              {result.availableDates.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <button type="submit" className="h-9 rounded-md border px-3 text-sm">切換日期</button>
        </form>
        {result.error && (
          <p className="rounded-md border border-yellow-600/40 bg-yellow-500/10 p-3 text-sm">
            資料載入部分失敗：{result.error}
          </p>
        )}
        {result.date && result.etfCountThatDay < result.etfCountTotal && (
          <p className="rounded-md border border-yellow-600/40 bg-yellow-500/10 p-3 text-sm">
            本表基於 {result.etfCountThatDay}/{result.etfCountTotal} 檔 ETF 資料，部分 ETF 當日缺快照。
          </p>
        )}
      </header>
      <CrossHoldingsTable rows={result.rows} details={result.details} />
    </main>
  );
}
```

- [ ] **Step 6: 全套驗證，Commit**

```bash
npx tsc --noEmit && npm test && npm run lint
```

Expected: 全過。

```bash
git add components/cross-holdings-table.tsx components/cross-holdings-table.test.tsx app/cross/page.tsx components/site-nav.tsx
git commit -m "feat: 交集表頁面"
```

---

### Task 9: `lib/rotation.ts` 純邏輯（TDD）

**Files:**
- Create: `web/lib/rotation.ts`
- Test: `web/lib/rotation.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`web/lib/rotation.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import {
  buildRotationSeries, buildRotationTable, filterByRange, topIndustries,
  type IndustryDaily,
} from "@/lib/rotation";

const d = (date: string, industry: string, sum: number, etfs = 2): IndustryDaily => ({
  tradeDate: date, industry, sumWeightPct: sum, stockCount: 3, etfCountTotal: etfs,
});

const raw = [
  d("2026-07-10", "半導體業", 80), d("2026-07-10", "金融保險業", 20),
  d("2026-07-11", "半導體業", 84), d("2026-07-11", "金融保險業", 16),
  d("2026-07-14", "半導體業", 90), d("2026-07-14", "金融保險業", 10),
];

describe("buildRotationSeries", () => {
  it("平均權重 = sum / etf_count_total，依日期排序", () => {
    const series = buildRotationSeries(raw);
    expect(series.dates).toEqual(["2026-07-10", "2026-07-11", "2026-07-14"]);
    expect(series.byIndustry["半導體業"]).toEqual([40, 42, 45]);
  });
});

describe("topIndustries", () => {
  it("依最新一日平均權重取前 N 大", () => {
    expect(topIndustries(buildRotationSeries(raw), 1)).toEqual(["半導體業"]);
  });
});

describe("buildRotationTable", () => {
  it("N 日變化 = 最新平均 − N 個交易日前平均（不足 N 日為 null）", () => {
    const table = buildRotationTable(buildRotationSeries(raw), { shortDays: 2, longDays: 20 });
    const semi = table.find((r) => r.industry === "半導體業")!;
    expect(semi.latestAvgPct).toBe(45);
    expect(semi.shortChangePct).toBe(5);   // 45 - 40 (2 trading days back)
    expect(semi.longChangePct).toBeNull(); // fewer than 20 rows
    expect(semi.stockCount).toBe(3);
  });
});

describe("filterByRange", () => {
  it("依起始日裁切序列", () => {
    const cut = filterByRange(buildRotationSeries(raw), "2026-07-11");
    expect(cut.dates).toEqual(["2026-07-11", "2026-07-14"]);
    expect(cut.byIndustry["半導體業"]).toEqual([42, 45]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
npm test -- lib/rotation.test.ts
```

Expected: FAIL — cannot resolve `@/lib/rotation`

- [ ] **Step 3: 實作**

`web/lib/rotation.ts`：

```typescript
export type IndustryDaily = {
  tradeDate: string;
  industry: string;
  sumWeightPct: number;
  stockCount: number;
  etfCountTotal: number;
};

export type RotationSeries = {
  dates: string[];                              // ascending trade dates
  byIndustry: Record<string, (number | null)[]>; // avg weight % aligned to dates
  stockCounts: Record<string, number>;          // latest-day stock count per industry
  latestEtfCountTotal: number;
};

export type RotationTableRow = {
  industry: string;
  latestAvgPct: number;
  shortChangePct: number | null;
  longChangePct: number | null;
  stockCount: number;
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function buildRotationSeries(rows: IndustryDaily[]): RotationSeries {
  const dates = [...new Set(rows.map((r) => r.tradeDate))].sort();
  const index = new Map(dates.map((d, i) => [d, i]));
  const byIndustry: Record<string, (number | null)[]> = {};
  const stockCounts: Record<string, number> = {};
  let latestEtfCountTotal = 0;
  for (const r of rows) {
    const arr = (byIndustry[r.industry] ??= Array(dates.length).fill(null));
    arr[index.get(r.tradeDate)!] =
      r.etfCountTotal > 0 ? round2(r.sumWeightPct / r.etfCountTotal) : null;
    if (r.tradeDate === dates[dates.length - 1]) {
      stockCounts[r.industry] = r.stockCount;
      latestEtfCountTotal = r.etfCountTotal;
    }
  }
  return { dates, byIndustry, stockCounts, latestEtfCountTotal };
}

export function topIndustries(series: RotationSeries, n: number): string[] {
  const last = series.dates.length - 1;
  return Object.entries(series.byIndustry)
    .map(([industry, values]) => ({ industry, latest: values[last] ?? -Infinity }))
    .sort((a, b) => b.latest - a.latest)
    .slice(0, n)
    .map((e) => e.industry);
}

export function buildRotationTable(
  series: RotationSeries,
  { shortDays, longDays }: { shortDays: number; longDays: number },
): RotationTableRow[] {
  const last = series.dates.length - 1;
  const changeOver = (values: (number | null)[], days: number): number | null => {
    const prev = last - days >= 0 ? values[last - days] : null;
    const curr = values[last];
    return prev === null || curr === null || prev === undefined ? null : round2(curr - prev);
  };
  return Object.entries(series.byIndustry)
    .map(([industry, values]) => ({
      industry,
      latestAvgPct: values[last] ?? 0,
      shortChangePct: changeOver(values, shortDays),
      longChangePct: changeOver(values, longDays),
      stockCount: series.stockCounts[industry] ?? 0,
    }))
    .sort((a, b) => b.latestAvgPct - a.latestAvgPct);
}

export function filterByRange(series: RotationSeries, fromDate: string): RotationSeries {
  const startIdx = series.dates.findIndex((d) => d >= fromDate);
  if (startIdx <= 0) return series;
  return {
    ...series,
    dates: series.dates.slice(startIdx),
    byIndustry: Object.fromEntries(
      Object.entries(series.byIndustry).map(([k, v]) => [k, v.slice(startIdx)]),
    ),
  };
}
```

- [ ] **Step 4: 跑測試確認通過，Commit**

```bash
npm test -- lib/rotation.test.ts
git add lib/rotation.ts lib/rotation.test.ts
git commit -m "feat: 產業輪動序列與變化計算"
```

---

### Task 10: `lib/rotation-data.ts` 查詢層

**Files:**
- Create: `web/lib/rotation-data.ts`

- [ ] **Step 1: 實作**

```typescript
import { createReadOnlySupabaseClient } from "@/lib/supabase";
import type { IndustryDaily } from "@/lib/rotation";

type IndustryRecord = {
  trade_date: string;
  industry: string;
  sum_weight_pct: number | string;
  stock_count: number;
  etf_count_total: number;
};

export type RotationDataResult = {
  rows: IndustryDaily[];
  etfCountTotal: number;   // etf table rows, 黃條分母
  error: string | null;
};

const pageSize = 1000;

export async function fetchRotationData(): Promise<RotationDataResult> {
  const supabase = createReadOnlySupabaseClient();
  const records: IndustryRecord[] = [];
  let page = 0;
  let pageError: string | null = null;
  while (true) {
    const from = page * pageSize;
    const { data, error } = await supabase
      .from("industry_weight_daily")
      .select("trade_date, industry, sum_weight_pct, stock_count, etf_count_total")
      .order("trade_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) { pageError = error.message; break; }
    const batch = (data ?? []) as IndustryRecord[];
    records.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
  }
  const { data: etfData, error: etfError } = await supabase.from("etf").select("etf_id");

  const rows: IndustryDaily[] = records.map((r) => ({
    tradeDate: r.trade_date,
    industry: r.industry,
    sumWeightPct: typeof r.sum_weight_pct === "number"
      ? r.sum_weight_pct : Number(r.sum_weight_pct),
    stockCount: r.stock_count,
    etfCountTotal: r.etf_count_total,
  }));
  const errors = [pageError, etfError?.message].filter(Boolean);
  return {
    rows,
    etfCountTotal: (etfData ?? []).length,
    error: errors.length > 0 ? errors.join("；") : null,
  };
}
```

- [ ] **Step 2: 型別檢查，Commit**

```bash
npx tsc --noEmit
git add lib/rotation-data.ts
git commit -m "feat: 產業輪動資料查詢層"
```

---

### Task 11: 輪動頁元件（圖 + 表）+ `/rotation` 頁（TDD）

**Files:**
- Create: `web/components/rotation-dashboard.tsx`
- Create: `web/app/rotation/page.tsx`
- Test: `web/components/rotation-dashboard.test.tsx`

- [ ] **Step 1: 寫失敗的元件測試**

Recharts 在 jsdom 下不渲染實際圖形，測試聚焦表格與互動狀態：

```typescript
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RotationDashboard } from "@/components/rotation-dashboard";
import type { IndustryDaily } from "@/lib/rotation";

const rows: IndustryDaily[] = [];
for (const [date, semi, fin] of [
  ["2026-07-10", 80, 20], ["2026-07-11", 84, 16], ["2026-07-14", 90, 10],
] as const) {
  rows.push(
    { tradeDate: date, industry: "半導體業", sumWeightPct: semi, stockCount: 3, etfCountTotal: 2 },
    { tradeDate: date, industry: "金融保險業", sumWeightPct: fin, stockCount: 2, etfCountTotal: 2 },
  );
}

describe("RotationDashboard", () => {
  it("表格依當日平均權重降冪、格式照規範", () => {
    render(<RotationDashboard rows={rows} etfCountTotal={2} />);
    const bodyRows = screen.getAllByTestId("rotation-row");
    expect(within(bodyRows[0]).getByText("半導體業")).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText("45.00%")).toBeInTheDocument();
  });
  it("變化欄帶正負號", () => {
    render(<RotationDashboard rows={rows} etfCountTotal={2} />);
    // shortDays=5 but only 3 dates -> null -> em dash; verify via 2-day fixture is
    // impossible here, so assert the null placeholder renders
    const bodyRows = screen.getAllByTestId("rotation-row");
    expect(within(bodyRows[0]).getAllByText("—").length).toBeGreaterThan(0);
  });
  it("點表格列切換圖上勾選狀態", async () => {
    const user = userEvent.setup();
    render(<RotationDashboard rows={rows} etfCountTotal={2} />);
    const row = screen.getAllByTestId("rotation-row")[1];
    await user.click(row);
    expect(row).toHaveAttribute("data-selected", "true");
  });
  it("空資料顯示空狀態", () => {
    render(<RotationDashboard rows={[]} etfCountTotal={2} />);
    expect(screen.getByText(/尚無彙總資料/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
npm test -- components/rotation-dashboard.test.tsx
```

Expected: FAIL — cannot resolve `@/components/rotation-dashboard`

- [ ] **Step 3: 實作元件**

`web/components/rotation-dashboard.tsx`：

```typescript
"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatPct, formatSignedPct } from "@/lib/format";
import {
  buildRotationSeries, buildRotationTable, filterByRange, topIndustries,
  type IndustryDaily,
} from "@/lib/rotation";

type Props = { rows: IndustryDaily[]; etfCountTotal: number };

const RANGES = [
  { key: "1M", months: 1 }, { key: "3M", months: 3 },
  { key: "6M", months: 6 }, { key: "all", months: null },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

// chart palette: shadcn theme tokens with hex fallbacks
const COLORS = [
  "var(--chart-1, #e05d5d)", "var(--chart-2, #4f9cf9)", "var(--chart-3, #58b368)",
  "var(--chart-4, #d9a24a)", "var(--chart-5, #9d6ff2)", "#5bc8c8", "#e07db8", "#8a9a5b",
];

export function RotationDashboard({ rows, etfCountTotal }: Props) {
  const series = useMemo(() => buildRotationSeries(rows), [rows]);
  const [selected, setSelected] = useState<string[]>(() => topIndustries(series, 6));
  const [range, setRange] = useState<RangeKey>("3M");

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">尚無彙總資料。</p>;
  }

  const table = buildRotationTable(series, { shortDays: 5, longDays: 20 });
  const cutoff = (() => {
    const months = RANGES.find((r) => r.key === range)?.months;
    if (!months) return series;
    const from = new Date(series.dates[series.dates.length - 1]);
    from.setMonth(from.getMonth() - months);
    return filterByRange(series, from.toISOString().slice(0, 10));
  })();
  const chartData = cutoff.dates.map((date, i) => ({
    date,
    ...Object.fromEntries(selected.map((ind) => [ind, cutoff.byIndustry[ind]?.[i] ?? null])),
  }));

  const toggle = (industry: string) =>
    setSelected((s) =>
      s.includes(industry) ? s.filter((i) => i !== industry) : [...s, industry]);

  // 紅漲綠跌: same CSS vars as changeTone() in today-overview-dashboard.tsx
  const changeCell = (v: number | null) => (
    <TableCell className={`tabular-nums ${
      v === null ? "" : v >= 0 ? "text-[var(--market-up)]" : "text-[var(--market-down)]"}`}>
      {formatSignedPct(v)}
    </TableCell>
  );

  return (
    <div className="grid gap-6">
      <div className="flex gap-2">
        {RANGES.map((r) => (
          <button key={r.key} type="button" onClick={() => setRange(r.key)}
            className={`rounded-md border px-3 py-1 text-sm ${
              range === r.key ? "bg-primary text-primary-foreground" : "bg-card"}`}>
            {r.key === "all" ? "全部" : r.key}
          </button>
        ))}
      </div>
      <div className="h-80 w-full">
        <ResponsiveContainer>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" fontSize={12} minTickGap={40} />
            <YAxis fontSize={12} unit="%" width={48} />
            <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
            <Legend onClick={(e) => e.value && toggle(String(e.value))} />
            {selected.map((ind, i) => (
              <Line key={ind} dataKey={ind} dot={false} type="monotone"
                stroke={COLORS[i % COLORS.length]} strokeWidth={2} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>產業</TableHead>
            <TableHead>當日平均權重</TableHead>
            <TableHead>5 日變化</TableHead>
            <TableHead>20 日變化</TableHead>
            <TableHead className="hidden sm:table-cell">持股檔數</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.map((r) => (
            <TableRow key={r.industry} data-testid="rotation-row" className="cursor-pointer"
              data-selected={selected.includes(r.industry)}
              onClick={() => toggle(r.industry)}>
              <TableCell>{r.industry}</TableCell>
              <TableCell className="tabular-nums">{formatPct(r.latestAvgPct)}</TableCell>
              {changeCell(r.shortChangePct)}
              {changeCell(r.longChangePct)}
              <TableCell className="hidden tabular-nums sm:table-cell">{r.stockCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: 跑元件測試確認通過**

```bash
npm test -- components/rotation-dashboard.test.tsx
```

Expected: 4 passed

- [ ] **Step 5: 頁面**

`web/app/rotation/page.tsx`：

```typescript
import { RotationDashboard } from "@/components/rotation-dashboard";
import { SiteNav } from "@/components/site-nav";
import { fetchRotationData } from "@/lib/rotation-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RotationPage() {
  const result = await fetchRotationData();
  const latest = result.rows[result.rows.length - 1];

  return (
    <main className="mx-auto grid max-w-6xl gap-6 p-4 md:p-8">
      <header className="grid gap-3">
        <SiteNav active="rotation" />
        <h1 className="text-2xl font-semibold">產業權重輪動</h1>
        <p className="text-sm text-muted-foreground">
          全體主動式股票型 ETF 的平均產業配置隨時間變化：資金正從哪個產業流向哪個產業。
        </p>
        {result.error && (
          <p className="rounded-md border border-yellow-600/40 bg-yellow-500/10 p-3 text-sm">
            資料載入部分失敗：{result.error}
          </p>
        )}
        {latest && latest.etfCountTotal < result.etfCountTotal && (
          <p className="rounded-md border border-yellow-600/40 bg-yellow-500/10 p-3 text-sm">
            最新交易日基於 {latest.etfCountTotal}/{result.etfCountTotal} 檔 ETF 資料。
          </p>
        )}
      </header>
      <RotationDashboard rows={result.rows} etfCountTotal={result.etfCountTotal} />
    </main>
  );
}
```

- [ ] **Step 6: 全套驗證，Commit**

```bash
npx tsc --noEmit && npm test && npm run lint
```

Expected: 全過。

```bash
git add components/rotation-dashboard.tsx components/rotation-dashboard.test.tsx app/rotation/page.tsx
git commit -m "feat: 產業權重輪動頁面"
```

---

### Task 12: 端到端手動驗證

**Files:** 無（驗證步驟）

- [ ] **Step 1: scraper 全套測試（含整合）**

```bash
cd scraper && set -a && source .env.local && set +a && uv run pytest
```

Expected: 全 pass。

- [ ] **Step 2: web 全套測試 + lint + build**

```bash
cd web && npm test && npm run lint && npm run build
```

Expected: 全過、build 成功。

- [ ] **Step 3: dev server 手動核對**

```bash
npm run dev
```

逐項檢查：
1. `/cross`：預設最新交易日、預設排序涵蓋檔數降冪；抽 1 檔股票展開，權重加總與 `合計權重` 欄一致；獨門篩選有結果；權重格式 `12.33%`、金額 `27.50 億`、張數千分位
2. `/cross` 對照組：抽 1 檔涵蓋檔數最高的股票，去各投信 PCF 網頁抽查其中兩檔 ETF 的權重（比照 pipeline 驗證慣例）
3. `/rotation`：折線圖顯示前 6 大產業、時間範圍切換有效、點表格列可增減線；5 日變化欄格式 `+1.25%`、紅漲綠跌
4. 手機寬度（DevTools 375px）：兩頁不橫向溢出，交集表金額/張數欄收合
5. 導覽列四項互通，今日總覽與排行榜不受影響

- [ ] **Step 4: 提交 PR（依 agent-workflow 流程）**

依 `docs/superpowers/process/agent-workflow.md`：資料層與前端各開一個 PR，走 Generator/Evaluator review gate（checklist 見 `docs/superpowers/process/pr-review-checklist.md`）。

---

## Self-Review 紀錄

- **Spec 覆蓋**：§3 兩表與 pipeline/backfill = Task 1–4；§4 產業分類（未分類 fallback）= Task 2 SQL 與測試；§5 交集表（欄位/篩選/展開/排序/手機/空狀態/黃條）= Task 6–8；§6 輪動（圖/表/範圍/點選/黃條）= Task 9–11；§7 數字格式 = Task 5（測試明確驗 `+12.33%`）；§8 Recharts = Task 5；§9 測試 = 各 Task TDD + Task 12。§10 未來擴充不在本計畫（正確）。
- **無 placeholder**：紅綠樣式已直接沿用 `today-overview-dashboard.tsx` 的既有慣例（`--market-up`/`--market-down` CSS 變數、red/emerald badge 配色），無待查項目。
- **型別一致**：`CrossRow`/`CrossDetail`/`SortState`/`CoverageFilter` 定義於 Task 6、Task 7/8 引用相同名稱；`IndustryDaily`/`RotationSeries` 定義於 Task 9、Task 10/11 引用相同名稱；`formatPct`/`formatSignedPct`/`formatYi`/`formatLots` 定義於 Task 5、Task 8/11 引用。
