import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createReadOnlySupabaseClient: createClientMock,
}));

import { fetchCrossHoldings } from "@/lib/cross-holdings-data";
import { fetchRotationData } from "@/lib/rotation-data";

type DataRecord = Record<string, unknown>;
type Filter = { kind: "eq" | "gte" | "in"; column: string; value: unknown };
type QueryExecution = {
  table: string;
  filters: Filter[];
  orders: Array<{ column: string; ascending: boolean }>;
  range: [number, number] | null;
  limit: number | null;
};

class QueryBuilder implements PromiseLike<{ data: DataRecord[]; error: null }> {
  private readonly filters: Filter[] = [];
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
      limit: this.selectedLimit,
    });

    let rows = this.records.filter((record) =>
      this.filters.every((filter) => {
        const value = record[filter.column];
        if (filter.kind === "eq") return value === filter.value;
        if (filter.kind === "gte") return String(value) >= String(filter.value);
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

function installSupabaseDouble(datasets: Record<string, DataRecord[]>) {
  const executions: QueryExecution[] = [];
  createClientMock.mockReturnValue({
    from(table: string) {
      return new QueryBuilder(table, datasets[table] ?? [], executions);
    },
  });
  return executions;
}

function crossRecord(stockId: string): DataRecord {
  return {
    trade_date: "2026-07-15",
    stock_id: stockId,
    etf_count: 2,
    total_weight_pct: 10,
    total_shares: 1000,
    total_value_twd: 100000,
    new_count: 0,
    add_count: 0,
    trim_count: 0,
    exit_count: 0,
  };
}

describe("fetchCrossHoldings", () => {
  beforeEach(() => createClientMock.mockReset());

  it("只分批查詢當日結果涉及的 stock_info，不受整表 1,000 筆上限截斷", async () => {
    const stockIds = ["2330", ...Array.from({ length: 475 }, (_, i) => `T${String(i).padStart(4, "0")}`)];
    const filler = Array.from({ length: 1500 }, (_, i) => ({
      stock_id: `F${String(i).padStart(4, "0")}`,
      name: `填充 ${i}`,
      industry: "其他",
    }));
    const metadata = stockIds.map((stockId) => ({
      stock_id: stockId,
      name: stockId === "2330" ? "台積電" : `股票 ${stockId}`,
      industry: stockId === "2330" ? "半導體業" : "其他",
    }));
    const executions = installSupabaseDouble({
      dashboard_cross_dates: [{ trade_date: "2026-07-15" }],
      cross_holdings_daily: stockIds.map(crossRecord),
      holdings_snapshot: [],
      holding_change: [],
      etf: [{ etf_id: "00980A" }],
      stock_info: [...filler, ...metadata],
    });

    const result = await fetchCrossHoldings("2026-07-15");

    expect(result.rows).toHaveLength(476);
    expect(result.rows.find((row) => row.stockId === "2330")).toMatchObject({
      stockName: "台積電",
      industry: "半導體業",
    });
    const stockQueries = executions.filter((query) => query.table === "stock_info");
    expect(stockQueries.length).toBeGreaterThan(1);
    expect(
      stockQueries.every((query) => {
        const filter = query.filters.find((item) => item.kind === "in");
        return filter && (filter.value as unknown[]).length <= 200;
      }),
    ).toBe(true);
  });

  it("所有跨頁查詢都使用完整主鍵順序", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => String(i).padStart(4, "0"));
    const executions = installSupabaseDouble({
      dashboard_cross_dates: [{ trade_date: "2026-07-15" }],
      cross_holdings_daily: ids.map(crossRecord),
      holdings_snapshot: ids.map((stockId) => ({
        trade_date: "2026-07-15",
        etf_id: "00980A",
        stock_id: stockId,
        shares: 100,
        weight_pct: 1,
        etf: { name: "野村臺灣智慧優選主動式 ETF" },
      })),
      holding_change: ids.map((stockId) => ({
        trade_date: "2026-07-15",
        etf_id: "00980A",
        stock_id: stockId,
        change_type: "ADD",
      })),
      etf: [{ etf_id: "00980A" }],
      stock_info: ids.map((stockId) => ({ stock_id: stockId, name: stockId, industry: "其他" })),
    });

    await fetchCrossHoldings("2026-07-15");

    const expectedOrders: Record<string, string> = {
      cross_holdings_daily: "stock_id",
      holdings_snapshot: "etf_id,stock_id",
      holding_change: "etf_id,stock_id",
    };
    for (const [table, order] of Object.entries(expectedOrders)) {
      const queries = executions.filter((query) => query.table === table);
      expect(queries.some((query) => query.range?.[0] === 1000)).toBe(true);
      expect(queries.every((query) => query.orders.map((item) => item.column).join(",") === order)).toBe(true);
    }
  });
});

describe("fetchRotationData", () => {
  beforeEach(() => createClientMock.mockReset());

  it("預設只查最新彙總日以前三個月", async () => {
    const executions = installSupabaseDouble({
      industry_weight_daily: [
        { trade_date: "2025-01-02", industry: "舊資料", sum_weight_pct: 1, stock_count: 1, etf_count_total: 2 },
        { trade_date: "2026-04-17", industry: "金融保險業", sum_weight_pct: 20, stock_count: 2, etf_count_total: 2 },
        { trade_date: "2026-07-17", industry: "半導體業", sum_weight_pct: 80, stock_count: 3, etf_count_total: 2 },
      ],
      etf: [{ etf_id: "00980A" }, { etf_id: "00981A" }],
    });

    const result = await fetchRotationData();

    expect(result.rows.map((row) => row.tradeDate)).toEqual(["2026-04-17", "2026-07-17"]);
    const pagedQuery = executions.find(
      (query) => query.table === "industry_weight_daily" && query.range !== null,
    );
    expect(pagedQuery?.filters).toContainEqual({
      kind: "gte",
      column: "trade_date",
      value: "2026-04-17",
    });
  });

  it("跨頁資料依 trade_date、industry 唯一排序", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      trade_date: "2026-07-17",
      industry: `產業 ${String(i).padStart(4, "0")}`,
      sum_weight_pct: i,
      stock_count: 1,
      etf_count_total: 2,
    }));
    const executions = installSupabaseDouble({
      industry_weight_daily: rows,
      etf: [{ etf_id: "00980A" }],
    });

    const result = await fetchRotationData();

    expect(result.rows).toHaveLength(1001);
    const pagedQueries = executions.filter(
      (query) => query.table === "industry_weight_daily" && query.range !== null,
    );
    expect(pagedQueries.some((query) => query.range?.[0] === 1000)).toBe(true);
    expect(
      pagedQueries.every(
        (query) => query.orders.map((item) => item.column).join(",") === "trade_date,industry",
      ),
    ).toBe(true);
  });
});
