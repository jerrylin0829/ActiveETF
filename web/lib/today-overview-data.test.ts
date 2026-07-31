import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createReadOnlySupabaseClient: createClientMock,
}));

import { fetchTodayOverview } from "@/lib/today-overview-data";

type RecordValue = string | number | null;
type DataRecord = Record<string, unknown>;

type QueryExecution = {
  table: string;
  filters: Array<{ kind: "eq" | "gte" | "lte" | "lt" | "in"; column: string; value: unknown }>;
  orders: Array<{ column: string; ascending: boolean }>;
  range: [number, number] | null;
};

class QueryBuilder implements PromiseLike<{ data: DataRecord[]; error: null }> {
  private readonly filters: QueryExecution["filters"] = [];
  private readonly orders: QueryExecution["orders"] = [];
  private selectedRange: [number, number] | null = null;
  private selectedLimit: number | null = null;

  constructor(
    private readonly table: string,
    private readonly records: DataRecord[],
    private readonly executions: QueryExecution[],
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

  lt(column: string, value: unknown) {
    this.filters.push({ kind: "lt", column, value });
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

  then<TResult1 = { data: DataRecord[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: DataRecord[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
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
    });

    let rows = this.records.filter((record) =>
      this.filters.every((filter) => {
        const value = record[filter.column] as RecordValue;
        if (filter.kind === "eq") return value === filter.value;
        if (filter.kind === "gte") return String(value) >= String(filter.value);
        if (filter.kind === "lte") return String(value) <= String(filter.value);
        if (filter.kind === "lt") return Number(value) < Number(filter.value);
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

    if (this.selectedLimit !== null) {
      rows = rows.slice(0, this.selectedLimit);
    }
    if (this.selectedRange) {
      rows = rows.slice(this.selectedRange[0], this.selectedRange[1] + 1);
    } else if (this.selectedLimit === null) {
      rows = rows.slice(0, 1000);
    }

    return { data: rows, error: null };
  }
}

function installSupabaseDouble(overrides: Partial<Record<string, DataRecord[]>> = {}) {
  const executions: QueryExecution[] = [];
  const datasets: Record<string, DataRecord[]> = {
    dashboard_holding_change_dates: [{ trade_date: "2026-07-14" }],
    dashboard_holding_snapshot_dates: [{ trade_date: "2026-07-14" }],
    holding_change: [],
    scrape_log: [],
    etf: [{ etf_id: "00987A", name: "台新優勢成長" }],
    stock_info: [],
    stock_price: [],
    open_position: [],
    ...overrides,
  };
  const client = {
    from(table: string) {
      return new QueryBuilder(table, datasets[table] ?? [], executions);
    },
  };
  createClientMock.mockReturnValue(client);
  return executions;
}

describe("fetchTodayOverview", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("does not warn when the latest scrape attempt changed from fail to ok", async () => {
    installSupabaseDouble({
      scrape_log: [
        {
          id: 55,
          etf_id: "00987A",
          trade_date: "2026-07-14",
          run_at: "2026-07-14T11:56:07Z",
          status: "fail",
          error: "ValidationError: empty holdings",
        },
        {
          id: 68,
          etf_id: "00987A",
          trade_date: "2026-07-14",
          run_at: "2026-07-14T15:08:39Z",
          status: "ok",
          error: null,
        },
      ],
    });

    const result = await fetchTodayOverview({ date: "2026-07-14" });

    expect(result.warnings).toEqual([]);
  });

  it("warns when the latest scrape attempt changed from ok to fail", async () => {
    installSupabaseDouble({
      scrape_log: [
        {
          id: 55,
          etf_id: "00987A",
          trade_date: "2026-07-14",
          run_at: "2026-07-14T11:56:07Z",
          status: "ok",
          error: null,
        },
        {
          id: 68,
          etf_id: "00987A",
          trade_date: "2026-07-14",
          run_at: "2026-07-14T15:08:39Z",
          status: "fail",
          error: "HTTP 503",
        },
      ],
    });

    const result = await fetchTodayOverview({ date: "2026-07-14" });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].description).toContain("00987A 台新優勢成長（HTTP 503）");
  });

  it("keeps all holding-change pages under a complete primary-key order", async () => {
    const changes = Array.from({ length: 1001 }, (_, index) => ({
      etf_id: "00987A",
      trade_date: "2026-07-14",
      stock_id: String(index).padStart(4, "0"),
      change_type: "ADD",
      shares_delta: 1,
      weight_delta_pct: 0.05,
      etf: { name: "台新優勢成長", issuer: "台新" },
    }));
    const executions = installSupabaseDouble({ holding_change: changes });

    const result = await fetchTodayOverview({ date: "2026-07-14", range: "day" });

    expect(result.changeEvents).toHaveLength(1001);
    const changeQueries = executions.filter((execution) => execution.table === "holding_change");
    expect(changeQueries.some((query) => query.range?.[0] === 1000)).toBe(true);
    expect(changeQueries.every((query) => query.orders.map((order) => order.column).join(",") === "trade_date,etf_id,stock_id")).toBe(true);
  });

  it.each([
    ["week_prev", "2026-07-13", "2026-07-17"],
    ["month_prev", "2026-06-01", "2026-06-30"],
  ])("queries %s using its complete previous-period bounds", async (range, start, end) => {
    const executions = installSupabaseDouble({
      dashboard_holding_change_dates: [{ trade_date: "2026-07-22" }],
      dashboard_holding_snapshot_dates: [{ trade_date: "2026-07-22" }],
    });

    const result = await fetchTodayOverview({ date: "2026-07-22", range });

    expect(result.range).toBe(range);
    const boundedQuery = executions.find(
      (execution) =>
        execution.table === "holding_change" &&
        execution.filters.some(
          (filter) =>
            filter.kind === "gte" &&
            filter.column === "trade_date" &&
            filter.value === start,
        ),
    );
    expect(boundedQuery?.filters).toContainEqual({
      kind: "lte",
      column: "trade_date",
      value: end,
    });
  });

  it("builds radar narratives with cached holding days, industry, and event-day closes", async () => {
    const executions = installSupabaseDouble({
      dashboard_holding_snapshot_dates: [
        { trade_date: "2026-07-10" },
        { trade_date: "2026-07-11" },
        { trade_date: "2026-07-14" },
      ],
      holding_change: [
        {
          etf_id: "00987A",
          trade_date: "2026-07-10",
          stock_id: "2486",
          change_type: "NEW",
          shares_delta: 1000,
          weight_delta_pct: 1,
          etf: { name: "台新優勢成長", issuer: "台新" },
        },
        {
          etf_id: "00987A",
          trade_date: "2026-07-11",
          stock_id: "2486",
          change_type: "ADD",
          shares_delta: 500,
          weight_delta_pct: 0.5,
          etf: { name: "台新優勢成長", issuer: "台新" },
        },
        {
          etf_id: "00987A",
          trade_date: "2026-07-14",
          stock_id: "2486",
          change_type: "TRIM",
          shares_delta: -100,
          weight_delta_pct: -0.1,
          etf: { name: "台新優勢成長", issuer: "台新" },
        },
      ],
      stock_info: [{ stock_id: "2486", name: "一詮", industry: "電子零組件業" }],
      stock_price: [
        { stock_id: "2486", trade_date: "2026-07-10", close: 100 },
        { stock_id: "2486", trade_date: "2026-07-11", close: 110 },
        { stock_id: "2486", trade_date: "2026-07-14", close: 120 },
      ],
      open_position: [{
        etf_id: "00987A",
        stock_id: "2486",
        entry_date: "2026-07-10",
        as_of_date: "2026-07-14",
        holding_days: 2,
        excess_return_pct: 3.5,
      }],
    });

    const result = await fetchTodayOverview({ date: "2026-07-14" });

    expect(result.radarNarratives[0]).toMatchObject({
      stockId: "2486",
      stockName: "一詮",
      industry: "電子零組件業",
      entryValueTwd: 100000,
      addValueTwd: 55000,
      followUpCount: 1,
      segment: "single_add",
    });
    expect(result.radarNarratives[0].legs[0]).toMatchObject({
      holdingTradingDays: 2,
      excessReturnPct: 3.5,
    });
    expect(result.radarNarratives[0].legs[0].followUps.map((event) => event.changeType)).toEqual([
      "ADD",
      "TRIM",
    ]);

    const radarQuery = executions.find(
      (execution) =>
        execution.table === "holding_change" &&
        execution.filters.some(
          (filter) => filter.kind === "in" && filter.column === "change_type",
        ),
    );
    expect(radarQuery?.filters).toContainEqual({
      kind: "in",
      column: "change_type",
      value: ["NEW", "EXIT", "ADD", "TRIM"],
    });
    const priceQueries = executions.filter((execution) => execution.table === "stock_price");
    expect(priceQueries.every((query) => query.filters.some(
      (filter) => filter.kind === "gte" && filter.column === "trade_date" && filter.value === "2026-07-10",
    ))).toBe(true);
  });

  it("pages open_position with deterministic primary-key ordering", async () => {
    const positions = Array.from({ length: 1001 }, (_, index) => ({
      etf_id: "00987A",
      stock_id: String(index).padStart(4, "0"),
      entry_date: "2026-07-14",
      as_of_date: "2026-07-14",
      holding_days: 0,
      excess_return_pct: 0,
    }));
    const executions = installSupabaseDouble({ open_position: positions });

    await fetchTodayOverview({ date: "2026-07-14" });

    const positionQueries = executions.filter(
      (execution) => execution.table === "open_position",
    );
    expect(positionQueries.some((query) => query.range?.[0] === 1000)).toBe(true);
    expect(
      positionQueries.every(
        (query) => query.orders.map((order) => order.column).join(",") ===
          "etf_id,stock_id,entry_date",
      ),
    ).toBe(true);
  });

  it("queries bounded daily closes and joins them to collective values", async () => {
    const executions = installSupabaseDouble({
      holding_change: [
        {
          etf_id: "00980A",
          trade_date: "2026-07-13",
          stock_id: "2330",
          change_type: "ADD",
          shares_delta: 1000,
          weight_delta_pct: 0.1,
          etf: { name: "主動野村臺灣優選", issuer: "野村" },
        },
        {
          etf_id: "00981A",
          trade_date: "2026-07-14",
          stock_id: "2330",
          change_type: "NEW",
          shares_delta: 2000,
          weight_delta_pct: 0.2,
          etf: { name: "主動統一台股增長", issuer: "統一" },
        },
      ],
      stock_price: [
        { stock_id: "2330", trade_date: "2026-07-13", close: 1000 },
        { stock_id: "2330", trade_date: "2026-07-14", close: 1010 },
        { stock_id: "2330", trade_date: "2026-07-12", close: 990 },
      ],
    });

    const result = await fetchTodayOverview({ date: "2026-07-14", range: "week" });

    expect(result.collective.increases[0]).toMatchObject({
      stockId: "2330",
      etfCount: 2,
      totalValueTwd: 3020000,
    });
    const priceQueries = executions.filter((execution) => execution.table === "stock_price");
    expect(priceQueries.length).toBeGreaterThan(0);
    expect(priceQueries.every((query) => query.filters.some((filter) =>
      filter.kind === "gte" && filter.column === "trade_date" && filter.value === "2026-07-13",
    ))).toBe(true);
    expect(priceQueries.every((query) => query.filters.some((filter) =>
      filter.kind === "lte" && filter.column === "trade_date" && filter.value === "2026-07-14",
    ))).toBe(true);
    expect(
      priceQueries.every(
        (query) => query.orders.map((order) => order.column).join(",") ===
          "trade_date,stock_id",
      ),
    ).toBe(true);
  });

  it("keeps a collective value null when an event-day close is missing", async () => {
    installSupabaseDouble({
      holding_change: [
        {
          etf_id: "00980A",
          trade_date: "2026-07-13",
          stock_id: "2330",
          change_type: "ADD",
          shares_delta: 1000,
          weight_delta_pct: 0.1,
          etf: { name: "主動野村臺灣優選", issuer: "野村" },
        },
        {
          etf_id: "00981A",
          trade_date: "2026-07-14",
          stock_id: "2330",
          change_type: "NEW",
          shares_delta: 2000,
          weight_delta_pct: 0.2,
          etf: { name: "主動統一台股增長", issuer: "統一" },
        },
      ],
      stock_price: [
        { stock_id: "2330", trade_date: "2026-07-13", close: 1000 },
      ],
    });

    const result = await fetchTodayOverview({ date: "2026-07-14", range: "week" });

    expect(result.collective.increases[0]?.totalValueTwd).toBeNull();
  });

  it("pages monthly close rows under a complete primary-key order", async () => {
    const stockIds = Array.from({ length: 100 }, (_, index) =>
      String(2000 + index),
    );
    const dates = Array.from({ length: 11 }, (_, index) =>
      `2026-07-${String(index + 1).padStart(2, "0")}`,
    );
    const executions = installSupabaseDouble({
      dashboard_holding_change_dates: [{ trade_date: "2026-07-14" }],
      holding_change: stockIds.map((stockId) => ({
        etf_id: "00980A",
        trade_date: "2026-07-14",
        stock_id: stockId,
        change_type: "ADD",
        shares_delta: 1000,
        weight_delta_pct: 0.1,
        etf: { name: "主動野村臺灣優選", issuer: "野村" },
      })),
      stock_price: stockIds.flatMap((stockId) =>
        dates.map((tradeDate) => ({
          stock_id: stockId,
          trade_date: tradeDate,
          close: 100,
        })),
      ),
    });

    await fetchTodayOverview({ date: "2026-07-14", range: "month" });

    const priceQueries = executions.filter(
      (execution) => execution.table === "stock_price",
    );
    expect(priceQueries.some((query) => query.range?.[0] === 1000)).toBe(true);
    expect(
      priceQueries.every(
        (query) => query.orders.map((order) => order.column).join(",") ===
          "trade_date,stock_id",
      ),
    ).toBe(true);
  });
});
