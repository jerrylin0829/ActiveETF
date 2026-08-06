import { describe, expect, it } from "vitest";

import { orderRecentScrapeLogs } from "@/lib/scrape-log-query";

describe("orderRecentScrapeLogs", () => {
  it("prioritizes recent trade dates before backfill execution time", () => {
    const orders: Array<{ column: string; ascending: boolean }> = [];
    const query = {
      order(column: string, options: { ascending: boolean }) {
        orders.push({ column, ascending: options.ascending });
        return this;
      },
    };

    expect(orderRecentScrapeLogs(query)).toBe(query);
    expect(orders).toEqual([
      { column: "trade_date", ascending: false },
      { column: "run_at", ascending: false },
      { column: "id", ascending: false },
    ]);
  });
});
