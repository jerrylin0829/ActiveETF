import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  createReadOnlySupabaseClient: createClientMock,
}));

import { fetchStockLookup } from "@/lib/stock-lookup-data";

type DataRecord = Record<string, unknown>;
type Filter = { kind: "eq" | "gte" | "lte" | "in"; column: string; value: unknown };
type QueryExecution = {
  table: string;
  filters: Filter[];
  orders: Array<{ column: string; ascending: boolean }>;
  range: [number, number] | null;
  limit: number | null;
};
type QueryResult = { data: DataRecord[]; error: { message: string } | null };

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

  select() { return this; }
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

  private execute(): QueryResult {
    this.executions.push({
      table: this.table,
      filters: [...this.filters],
      orders: [...this.orders],
      range: this.selectedRange,
      limit: this.selectedLimit,
    });
    if (this.errorMessage) return { data: [], error: { message: this.errorMessage } };

    let rows = this.records.filter((record) => this.filters.every((filter) => {
      const value = record[filter.column];
      if (filter.kind === "eq") return value === filter.value;
      if (filter.kind === "gte") return String(value) >= String(filter.value);
      if (filter.kind === "lte") return String(value) <= String(filter.value);
      return (filter.value as unknown[]).includes(value);
    }));
    rows = [...rows].sort((left, right) => {
      for (const order of this.orders) {
        const comparison = String(left[order.column]).localeCompare(String(right[order.column]));
        if (comparison !== 0) return order.ascending ? comparison : -comparison;
      }
      return 0;
    });
    if (this.selectedLimit !== null) rows = rows.slice(0, this.selectedLimit);
    if (this.selectedRange) rows = rows.slice(this.selectedRange[0], this.selectedRange[1] + 1);
    else if (this.selectedLimit === null) rows = rows.slice(0, 1000);
    return { data: rows, error: null };
  }
}

const dates = Array.from(
  { length: 31 },
  (_, index) => `2026-07-${String(31 - index).padStart(2, "0")}`,
);

function baseDatasets(): Record<string, DataRecord[]> {
  return {
    dashboard_holding_snapshot_dates: dates.map((tradeDate) => ({ trade_date: tradeDate })),
    holdings_snapshot: [
      { etf_id: "00980A", trade_date: dates[0], stock_id: "2330", shares: 10_000, weight_pct: 12 },
      { etf_id: "00981A", trade_date: dates[0], stock_id: "2330", shares: 20_000, weight_pct: 8 },
    ],
    cross_holdings_daily: [
      { trade_date: dates[1], stock_id: "2330", etf_count: 1, total_weight_pct: 10 },
      { trade_date: dates[0], stock_id: "2330", etf_count: 2, total_weight_pct: 20 },
    ],
    stock_info: [{ stock_id: "2330", name: "台積電", industry: "半導體業" }],
    holding_change: [
      { etf_id: "00980A", trade_date: dates[0], stock_id: "2330", change_type: "ADD", shares_delta: 1_000, weight_delta_pct: 0.5 },
      { etf_id: "00981A", trade_date: dates[1], stock_id: "2330", change_type: "NEW", shares_delta: 20_000, weight_delta_pct: 8 },
      { etf_id: "00980A", trade_date: "2026-06-01", stock_id: "2330", change_type: "TRIM", shares_delta: -100, weight_delta_pct: -0.1 },
    ],
    open_position: [
      { etf_id: "00980A", stock_id: "2330", entry_date: "2026-06-01", as_of_date: dates[0], holding_days: 20 },
      { etf_id: "00981A", stock_id: "2330", entry_date: dates[1], as_of_date: dates[0], holding_days: 1 },
    ],
    etf: [
      { etf_id: "00980A", name: "主動野村臺灣優選" },
      { etf_id: "00981A", name: "主動統一台股增長" },
    ],
    scrape_log: [
      { id: 1, etf_id: "00980A", trade_date: dates[0], run_at: "2026-07-31T10:00:00Z", status: "ok", error: null },
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

describe("fetchStockLookup", () => {
  beforeEach(() => createClientMock.mockReset());

  it("returns not found when the stock never appeared in snapshots", async () => {
    const executions = installSupabaseDouble({ holdings_snapshot: [] });

    expect(await fetchStockLookup("UNKNOWN")).toEqual({ found: false, error: null });
    expect(executions.map((execution) => execution.table)).toEqual(["holdings_snapshot"]);
  });

  it("uses the global latest trading date and joins all three sections", async () => {
    const executions = installSupabaseDouble();

    const result = await fetchStockLookup("2330");

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.detail).toMatchObject({
      stockId: "2330",
      stockName: "台積電",
      industry: "半導體業",
      latestDate: dates[0],
      latestEtfCount: 2,
      error: null,
      warnings: [],
    });
    expect(result.detail.holders.map((row) => row.etfId)).toEqual(["00980A", "00981A"]);
    expect(result.detail.holders[0]).toMatchObject({ changeType: "ADD", holdingDays: 20, isLongHeld: true });
    expect(result.detail.trend).toHaveLength(2);
    expect(result.detail.events.map((event) => event.tradeDate)).not.toContain("2026-06-01");

    const eventQuery = executions.find((execution) => execution.table === "holding_change");
    expect(eventQuery?.filters).toEqual(expect.arrayContaining([
      { kind: "eq", column: "stock_id", value: "2330" },
      { kind: "gte", column: "trade_date", value: dates[29] },
      { kind: "lte", column: "trade_date", value: dates[0] },
    ]));
    expect(eventQuery?.orders.map((order) => order.column)).toEqual([
      "trade_date",
      "etf_id",
      "stock_id",
    ]);
  });

  it("keeps a historical stock page but shows zero current holders", async () => {
    installSupabaseDouble({
      holdings_snapshot: [
        { etf_id: "00980A", trade_date: "2026-06-01", stock_id: "OLD", shares: 1_000, weight_pct: 1 },
      ],
      cross_holdings_daily: [],
      stock_info: [],
      holding_change: [],
      open_position: [],
    });

    const result = await fetchStockLookup("OLD");

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.detail).toMatchObject({
      stockName: "OLD",
      industry: "未分類",
      latestDate: dates[0],
      latestEtfCount: 0,
      holders: [],
    });
  });

  it("paginates event history with deterministic primary-key ordering", async () => {
    const changes = Array.from({ length: 1001 }, (_, index) => ({
      etf_id: `ETF${String(index).padStart(4, "0")}`,
      trade_date: dates[0],
      stock_id: "2330",
      change_type: "ADD",
      shares_delta: 1,
      weight_delta_pct: 0.1,
    }));
    const executions = installSupabaseDouble({ holding_change: changes });

    const result = await fetchStockLookup("2330");

    expect(result.found && result.detail.events).toHaveLength(1001);
    const secondPage = executions.find(
      (execution) => execution.table === "holding_change" && execution.range?.[0] === 1000,
    );
    expect(secondPage?.orders).toEqual([
      { column: "trade_date", ascending: false },
      { column: "etf_id", ascending: true },
      { column: "stock_id", ascending: true },
    ]);
  });

  it("paginates full trend and open positions under complete ordering", async () => {
    const trend = Array.from({ length: 1001 }, (_, index) => ({
      trade_date: `2020-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
      stock_id: "2330",
      etf_count: 1,
      total_weight_pct: index / 100,
    }));
    const positions = Array.from({ length: 1001 }, (_, index) => ({
      etf_id: "00980A",
      stock_id: "2330",
      entry_date: `2020-01-${String(index).padStart(4, "0")}`,
      as_of_date: dates[0],
      holding_days: index,
    }));
    const executions = installSupabaseDouble({
      cross_holdings_daily: trend,
      open_position: positions,
    });

    await fetchStockLookup("2330");

    const trendSecondPage = executions.find(
      (execution) => execution.table === "cross_holdings_daily" && execution.range?.[0] === 1000,
    );
    expect(trendSecondPage?.orders.map((order) => order.column)).toEqual(["trade_date", "stock_id"]);
    const positionSecondPage = executions.find(
      (execution) => execution.table === "open_position" && execution.range?.[0] === 1000,
    );
    expect(positionSecondPage?.orders.map((order) => order.column)).toEqual([
      "etf_id",
      "stock_id",
      "entry_date",
    ]);
  });

  it("keeps partial data and exposes child query errors", async () => {
    installSupabaseDouble({}, { stock_info: "metadata unavailable" });

    const result = await fetchStockLookup("2330");

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.detail.stockName).toBe("2330");
    expect(result.detail.holders).toHaveLength(2);
    expect(result.detail.error).toContain("metadata unavailable");
  });
});
