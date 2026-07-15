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
  filters: Array<{ kind: "eq" | "gte" | "lte" | "in"; column: string; value: unknown }>;
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
});
