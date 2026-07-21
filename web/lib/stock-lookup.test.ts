import { describe, expect, it } from "vitest";

import {
  buildStockHolderRows,
  filterStockTrendRange,
  normalizeStockLookupRange,
  type StockTrendPoint,
} from "@/lib/stock-lookup";

describe("buildStockHolderRows", () => {
  it("joins holder metadata and sorts by weight then ETF id", () => {
    const rows = buildStockHolderRows({
      holdings: [
        { etfId: "00982A", shares: 2_000, weightPct: 8 },
        { etfId: "00980A", shares: 1_000, weightPct: 8 },
        { etfId: "00981A", shares: 3_000, weightPct: 12 },
      ],
      etfNames: new Map([
        ["00980A", "主動 A"],
        ["00981A", "主動 B"],
      ]),
      changes: new Map([
        ["00980A", "ADD" as const],
        ["00981A", "NEW" as const],
      ]),
      openPositions: [
        {
          etfId: "00980A",
          entryDate: "2026-06-01",
          asOfDate: "2026-07-21",
          holdingDays: 20,
        },
        {
          etfId: "00981A",
          entryDate: "2026-07-01",
          asOfDate: "2026-07-21",
          holdingDays: 19,
        },
      ],
    });

    expect(rows.map((row) => row.etfId)).toEqual(["00981A", "00980A", "00982A"]);
    expect(rows[0]).toMatchObject({
      etfName: "主動 B",
      changeType: "NEW",
      holdingDays: 19,
      isLongHeld: false,
    });
    expect(rows[1]).toMatchObject({ holdingDays: 20, isLongHeld: true });
    expect(rows[2]).toMatchObject({
      etfName: "00982A",
      changeType: null,
      entryDate: null,
      holdingDays: null,
      isLongHeld: false,
    });
  });

  it("uses the newest open round for one ETF", () => {
    const [row] = buildStockHolderRows({
      holdings: [{ etfId: "00981A", shares: 3_000, weightPct: 12 }],
      etfNames: new Map(),
      changes: new Map(),
      openPositions: [
        { etfId: "00981A", entryDate: "2026-06-01", asOfDate: "2026-06-30", holdingDays: 20 },
        { etfId: "00981A", entryDate: "2026-07-20", asOfDate: "2026-07-21", holdingDays: 1 },
      ],
    });

    expect(row).toMatchObject({ entryDate: "2026-07-20", holdingDays: 1 });
  });
});

describe("stock lookup chart range", () => {
  const points: StockTrendPoint[] = [
    { tradeDate: "2025-12-20", totalWeightPct: 5, etfCount: 1 },
    { tradeDate: "2026-01-21", totalWeightPct: 6, etfCount: 2 },
    { tradeDate: "2026-04-21", totalWeightPct: 7, etfCount: 3 },
    { tradeDate: "2026-06-21", totalWeightPct: 8, etfCount: 4 },
    { tradeDate: "2026-07-21", totalWeightPct: 9, etfCount: 5 },
  ];

  it("normalizes unknown values to 3M", () => {
    expect(normalizeStockLookupRange(undefined)).toBe("3M");
    expect(normalizeStockLookupRange("bad")).toBe("3M");
    expect(normalizeStockLookupRange("all")).toBe("all");
  });

  it("filters only the displayed series relative to its latest date", () => {
    expect(filterStockTrendRange(points, "1M").map((point) => point.tradeDate)).toEqual([
      "2026-06-21",
      "2026-07-21",
    ]);
    expect(filterStockTrendRange(points, "3M").map((point) => point.tradeDate)).toEqual([
      "2026-04-21",
      "2026-06-21",
      "2026-07-21",
    ]);
    expect(filterStockTrendRange(points, "6M").map((point) => point.tradeDate)).toEqual([
      "2026-01-21",
      "2026-04-21",
      "2026-06-21",
      "2026-07-21",
    ]);
    expect(filterStockTrendRange(points, "all")).toEqual(points);
    expect(points).toHaveLength(5);
  });
});
