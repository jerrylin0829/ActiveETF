import { describe, expect, it } from "vitest";

import {
  mapMetricRecord,
  rankingMetricSelect,
  type MetricRecord,
} from "@/lib/rankings-data";

const record: MetricRecord = {
  etf_id: "00981A",
  trade_date: "2026-07-31",
  ret_1m: 0.1,
  ret_3m: null,
  ret_6m: null,
  ret_1y: null,
  ret_inception: 0.12,
  bench_0050_1m: 0.08,
  bench_0050_3m: null,
  bench_0050_6m: null,
  bench_0050_1y: null,
  bench_0050_inception: "0.09",
  timing_wins: 1,
  timing_months: 2,
  picking_realized_wins: 1,
  picking_realized_total: 2,
  picking_open_wins: 2,
  picking_open_total: 3,
  median_holding_days: 8,
  weekly_turnover_pct: 6.5,
  etf: { name: "主動統一台股增長", issuer: "統一" },
};

describe("ranking metric data mapping", () => {
  it("selects and maps the aligned 0050 inception benchmark", () => {
    expect(rankingMetricSelect).toContain("bench_0050_inception");
    expect(mapMetricRecord(record).bench0050Inception).toBe(0.09);
  });
});
