import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createReadOnlySupabaseClient: createClientMock,
}));

import { fetchEtfDetail } from "@/lib/etf-detail-data";

type RecordValue = string | number | null | Record<string, unknown>;
type DataRecord = Record<string, RecordValue>;
type Filter = { kind: "eq" | "gte" | "lte" | "in"; column: string; value: unknown };

type QueryExecution = {
  table: string;
  filters: Filter[];
  orders: Array<{ column: string; ascending: boolean }>;
  range: [number, number] | null;
  limit: number | null;
};

type QueryResult = {
  data: DataRecord[];
  error: { message: string } | null;
};

class QueryBuilder implements PromiseLike<QueryResult> {
  private readonly filters: Filter[] = [];
  private readonly orders: QueryExecution["orders"] = [];
  private selectedRange: [number, number] | null = null;
  private selectedLimit: number | null = null;

  constructor(
    private readonly table: string,
    private readonly records: DataRecord[],
    private readonly executions: QueryExecution[],
    private readonly errorMessage?: string,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ kind: "gte", column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ kind: "lte", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  order(column: string, { ascending = true }: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending });
    return this;
  }

  limit(value: number) {
    this.selectedLimit = value;
    return this;
  }

  range(from: number, to: number) {
    this.selectedRange = [from, to];
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute() {
    this.executions.push({
      table: this.table,
      filters: [...this.filters],
      orders: [...this.orders],
      range: this.selectedRange,
      limit: this.selectedLimit,
    });

    if (this.errorMessage) {
      return { data: [], error: { message: this.errorMessage } };
    }

    let rows = this.records.filter((record) =>
      this.filters.every((filter) => {
        const value = record[filter.column];
        if (filter.kind === "eq") return value === filter.value;
        if (filter.kind === "gte") return String(value) >= String(filter.value);
        if (filter.kind === "lte") return String(value) <= String(filter.value);
        return (filter.value as unknown[]).includes(value);
      }),
    );

    rows = [...rows].sort((left, right) => {
      for (const order of this.orders) {
        const comparison = String(left[order.column]).localeCompare(String(right[order.column]));
        if (comparison !== 0) return order.ascending ? comparison : -comparison;
      }
      return 0;
    });

    if (this.selectedLimit !== null) rows = rows.slice(0, this.selectedLimit);
    if (this.selectedRange) {
      rows = rows.slice(this.selectedRange[0], this.selectedRange[1] + 1);
    } else if (this.selectedLimit === null) {
      rows = rows.slice(0, 1000);
    }

    return { data: rows, error: null };
  }
}

const dates = Array.from(
  { length: 31 },
  (_, index) => `2026-07-${String(31 - index).padStart(2, "0")}`,
);

function baseDatasets(): Record<string, DataRecord[]> {
  const snapshots = dates.map((tradeDate) => ({
    etf_id: "00981A",
    trade_date: tradeDate,
    stock_id: "2317",
    shares: 1_000,
    weight_pct: tradeDate === dates[0] ? 8 : tradeDate === dates[1] ? 7.5 : 6,
  }));
  snapshots.push(
    {
      etf_id: "00981A",
      trade_date: dates[0],
      stock_id: "2330",
      shares: 2_000,
      weight_pct: 12,
    },
    {
      etf_id: "00981A",
      trade_date: dates[20],
      stock_id: "2330",
      shares: 1_000,
      weight_pct: 4,
    },
  );

  return {
    etf: [{ etf_id: "00981A", name: "主動統一台股增長", issuer: "統一", listed_date: "2026-05-01" }],
    dashboard_holding_snapshot_dates: dates.map((tradeDate) => ({ trade_date: tradeDate })),
    holdings_snapshot: snapshots,
    etf_metrics: [{
      etf_id: "00981A",
      trade_date: dates[0],
      ret_1m: 0.1,
      ret_3m: null,
      ret_6m: null,
      ret_1y: null,
      ret_inception: 0.12,
      bench_0050_1m: 0.08,
      bench_0050_3m: null,
      bench_0050_6m: null,
      bench_0050_1y: null,
      timing_wins: 1,
      timing_months: 2,
      picking_realized_wins: 1,
      picking_realized_total: 2,
      picking_open_wins: 2,
      picking_open_total: 3,
      median_holding_days: 8,
      weekly_turnover_pct: 6.5,
      etf: { name: "主動統一台股增長", issuer: "統一" },
    }],
    open_position: [
      { etf_id: "00981A", stock_id: "2317", entry_date: "2026-07-01", as_of_date: dates[0], holding_days: 22 },
      { etf_id: "00981A", stock_id: "2330", entry_date: "2026-07-25", as_of_date: dates[0], holding_days: 4 },
    ],
    holding_change: [
      { etf_id: "00981A", trade_date: "2026-06-01", stock_id: "2330", change_type: "ADD", shares_delta: 10, weight_delta_pct: 0.1 },
      { etf_id: "00981A", trade_date: "2026-07-20", stock_id: "2330", change_type: "EXIT", shares_delta: -1_000, weight_delta_pct: -4 },
      { etf_id: "00981A", trade_date: "2026-07-25", stock_id: "2330", change_type: "NEW", shares_delta: 2_000, weight_delta_pct: 12 },
    ],
    scrape_log: [
      { id: 1, etf_id: "00981A", trade_date: dates[0], run_at: "2026-07-31T10:00:00Z", status: "fail", error: "timeout" },
      { id: 2, etf_id: "00981A", trade_date: dates[0], run_at: "2026-07-31T11:00:00Z", status: "ok", error: null },
    ],
    stock_info: [
      { stock_id: "2317", name: "鴻海", industry: null },
      { stock_id: "2330", name: "台積電", industry: "半導體業" },
    ],
  };
}

function installSupabaseDouble(
  overrides: Partial<Record<string, DataRecord[]>> = {},
  errors: Partial<Record<string, string>> = {},
) {
  const executions: QueryExecution[] = [];
  const datasets = { ...baseDatasets(), ...overrides };
  createClientMock.mockReturnValue({
    from(table: string) {
      return new QueryBuilder(table, datasets[table] ?? [], executions, errors[table]);
    },
  });
  return executions;
}

describe("fetchEtfDetail", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("returns not found before querying holdings for an unknown ETF", async () => {
    const executions = installSupabaseDouble({ etf: [] });

    expect(await fetchEtfDetail("UNKNOWN")).toEqual({ found: false, error: null });
    expect(executions.map((execution) => execution.table)).toEqual(["etf"]);
  });

  it("resolves ETF trading dates, bounded timeline, metadata and one selected history", async () => {
    const executions = installSupabaseDouble();

    const result = await fetchEtfDetail("00981A", "2330");

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.detail).toMatchObject({
      latestDate: dates[0],
      previousDate: dates[1],
      twentyDayDate: dates[20],
      selectedStockId: "2330",
      selectedStockName: "台積電",
      error: null,
      warnings: [],
    });
    expect(result.detail.holdings).toHaveLength(2);
    expect(result.detail.holdings.find((row) => row.stockId === "2330")).toMatchObject({
      previousChange: "NEW",
      twentyDayChange: 8,
      holdingDays: 4,
    });
    expect(result.detail.weightHistory).toContainEqual({
      tradeDate: "2026-07-20",
      weightPct: null,
    });
    expect(result.detail.changes.map((event) => event.tradeDate)).not.toContain("2026-06-01");

    const historyQuery = executions.find(
      (execution) => execution.table === "holdings_snapshot"
        && execution.filters.some((filter) => filter.kind === "eq" && filter.column === "stock_id"),
    );
    expect(historyQuery?.filters).toEqual(expect.arrayContaining([
      { kind: "eq", column: "etf_id", value: "00981A" },
      { kind: "eq", column: "stock_id", value: "2330" },
    ]));
    expect(historyQuery?.orders.map((order) => order.column)).toEqual(["trade_date", "stock_id"]);

    const stockInfoQuery = executions.find((execution) => execution.table === "stock_info");
    expect(stockInfoQuery?.filters).toContainEqual({
      kind: "in",
      column: "stock_id",
      value: ["2317", "2330"],
    });
  });

  it("warns when this ETF snapshot is stale versus the global latest date", async () => {
    const snapshotRows = baseDatasets().holdings_snapshot.filter(
      (record) => record.trade_date !== dates[0],
    );
    installSupabaseDouble({ holdings_snapshot: snapshotRows });

    const result = await fetchEtfDetail("00981A");

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.detail.latestDate).toBe(dates[1]);
    expect(result.detail.warnings.some((warning) => warning.title === "ETF 快照尚未更新")).toBe(true);
  });

  it("shows only the latest unresolved scrape failure", async () => {
    installSupabaseDouble({
      scrape_log: [
        { id: 1, etf_id: "00981A", trade_date: dates[0], run_at: "2026-07-31T10:00:00Z", status: "ok", error: null },
        { id: 2, etf_id: "00981A", trade_date: dates[0], run_at: "2026-07-31T11:00:00Z", status: "fail", error: "HTTP 503" },
      ],
    });

    const result = await fetchEtfDetail("00981A");

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.detail.warnings).toContainEqual({
      title: "近期爬蟲失敗",
      description: `${dates[0]}：HTTP 503`,
    });
  });

  it("paginates snapshot rows under a complete primary-key order", async () => {
    const manyRows = Array.from({ length: 1001 }, (_, index) => ({
      etf_id: "00981A",
      trade_date: dates[0],
      stock_id: String(index).padStart(4, "0"),
      shares: 1_000,
      weight_pct: 0.05,
    }));
    const unrelatedHistory = Array.from({ length: 1500 }, (_, index) => ({
      etf_id: "OTHER",
      trade_date: "2020-01-01",
      stock_id: `X${index}`,
      shares: 1,
      weight_pct: 1,
    }));
    const executions = installSupabaseDouble({
      dashboard_holding_snapshot_dates: [{ trade_date: dates[0] }],
      holdings_snapshot: [...manyRows, ...unrelatedHistory],
      stock_info: [],
      open_position: [],
      holding_change: [],
    });

    const result = await fetchEtfDetail("00981A");

    expect(result.found && result.detail.holdings).toHaveLength(1001);
    const pagedQueries = executions.filter(
      (execution) => execution.table === "holdings_snapshot" && execution.range?.[0] === 1000,
    );
    expect(pagedQueries.length).toBeGreaterThan(0);
    expect(
      pagedQueries.every(
        (execution) => execution.orders.map((order) => order.column).join(",") === "trade_date,stock_id",
      ),
    ).toBe(true);
    expect(
      executions
        .filter((execution) => execution.table === "holdings_snapshot")
        .every((execution) => execution.filters.some(
          (filter) => filter.column === "trade_date" && filter.kind === "in"
            || filter.column === "stock_id" && filter.kind === "eq",
        )),
    ).toBe(true);
  });

  it("includes the second page of timeline events under a deterministic order", async () => {
    const changes = Array.from({ length: 1001 }, (_, index) => ({
      etf_id: "00981A",
      trade_date: dates[0],
      stock_id: `T${String(index).padStart(4, "0")}`,
      change_type: "ADD",
      shares_delta: index + 1,
      weight_delta_pct: 0.1,
    }));
    const executions = installSupabaseDouble({ holding_change: changes });

    const result = await fetchEtfDetail("00981A");

    expect(result.found && result.detail.changes).toHaveLength(1001);
    const secondPage = executions.find(
      (execution) => execution.table === "holding_change"
        && execution.range?.[0] === 1000
        && !execution.filters.some((filter) => filter.column === "stock_id"),
    );
    expect(secondPage?.orders.map((order) => order.column)).toEqual(["trade_date", "stock_id"]);
  });

  it("includes the second page of the selected stock full history", async () => {
    const selectedHistory = Array.from({ length: 1001 }, (_, index) => ({
      etf_id: "00981A",
      trade_date: `2020-01-${String(index).padStart(4, "0")}`,
      stock_id: "2330",
      shares: 1_000,
      weight_pct: index / 100,
    }));
    const executions = installSupabaseDouble({
      holdings_snapshot: [...baseDatasets().holdings_snapshot, ...selectedHistory],
    });

    const result = await fetchEtfDetail("00981A", "2330");

    expect(result.found && result.detail.weightHistory).toContainEqual({
      tradeDate: "2020-01-1000",
      weightPct: 10,
    });
    const secondPage = executions.find(
      (execution) => execution.table === "holdings_snapshot"
        && execution.range?.[0] === 1000
        && execution.filters.some(
          (filter) => filter.column === "stock_id" && filter.value === "2330",
        ),
    );
    expect(secondPage?.orders.map((order) => order.column)).toEqual(["trade_date", "stock_id"]);
  });

  it("keeps partial detail data and exposes a child query error", async () => {
    installSupabaseDouble({}, { stock_info: "stock_info unavailable" });

    const result = await fetchEtfDetail("00981A");

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.detail.holdings).toHaveLength(2);
    expect(result.detail.holdings[0].stockName).toBe(result.detail.holdings[0].stockId);
    expect(result.detail.error).toContain("stock_info unavailable");
  });
});
