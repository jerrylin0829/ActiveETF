import { describe, expect, it } from "vitest";

import {
  aggregateIndustryWeights,
  buildHoldingRows,
  buildWeightHistory,
  resolveSelectedStockId,
  sortHoldingRows,
  type EtfHoldingRow,
} from "@/lib/etf-detail";

const current = [
  { stockId: "2330", shares: 2_000, weightPct: 12 },
  { stockId: "2317", shares: 1_000, weightPct: 8 },
];

describe("buildHoldingRows", () => {
  it("uses current snapshot membership and marks a previous-day new holding", () => {
    const rows = buildHoldingRows({
      current,
      previous: [{ stockId: "2317", shares: 900, weightPct: 7.5 }],
      twentyDaysAgo: null,
      stockInfo: new Map([
        ["2330", { name: "台積電", industry: "半導體業" }],
        ["2317", { name: "鴻海", industry: null }],
        ["9999", { name: "已出清", industry: "其他" }],
      ]),
      openPositions: [],
    });

    expect(rows.map((row) => row.stockId)).toEqual(["2330", "2317"]);
    expect(rows[0]).toMatchObject({
      stockName: "台積電",
      industry: "半導體業",
      previousChange: "NEW",
      twentyDayChange: null,
    });
    expect(rows[1]).toMatchObject({
      industry: "未分類",
      previousChange: 0.5,
    });
    expect(rows.some((row) => row.stockId === "9999")).toBe(false);
  });

  it("subtracts zero for a stock absent on an existing 20-day comparison date", () => {
    const rows = buildHoldingRows({
      current: [current[0]],
      previous: null,
      twentyDaysAgo: [],
      stockInfo: new Map(),
      openPositions: [],
    });

    expect(rows[0]).toMatchObject({
      stockName: "2330",
      previousChange: null,
      twentyDayChange: 12,
    });
  });

  it("uses the latest open round and applies day 19/20 long-held boundary", () => {
    const day19 = buildHoldingRows({
      current: [current[0]],
      previous: [],
      twentyDaysAgo: [],
      stockInfo: new Map(),
      openPositions: [
        { stockId: "2330", entryDate: "2026-06-01", holdingDays: 30 },
        { stockId: "2330", entryDate: "2026-07-01", holdingDays: 19 },
      ],
    })[0];
    expect(day19).toMatchObject({ entryDate: "2026-07-01", holdingDays: 19, isLongHeld: false });

    const day20 = buildHoldingRows({
      current: [current[0]],
      previous: [],
      twentyDaysAgo: [],
      stockInfo: new Map(),
      openPositions: [{ stockId: "2330", entryDate: "2026-07-01", holdingDays: 20 }],
    })[0];
    expect(day20).toMatchObject({ holdingDays: 20, isLongHeld: true });
  });
});

describe("industry and history helpers", () => {
  const holdingRows: EtfHoldingRow[] = [
    {
      stockId: "2330",
      stockName: "台積電",
      industry: "半導體業",
      shares: 2_000,
      weightPct: 12,
      previousChange: 1,
      twentyDayChange: 2,
      entryDate: "2026-07-01",
      holdingDays: 20,
      isLongHeld: true,
    },
    {
      stockId: "2454",
      stockName: "聯發科",
      industry: "半導體業",
      shares: 1_000,
      weightPct: 7,
      previousChange: -1,
      twentyDayChange: null,
      entryDate: null,
      holdingDays: null,
      isLongHeld: false,
    },
    {
      stockId: "US1",
      stockName: "US1",
      industry: "未分類",
      shares: 500,
      weightPct: 3,
      previousChange: "NEW",
      twentyDayChange: 3,
      entryDate: null,
      holdingDays: null,
      isLongHeld: false,
    },
  ];

  it("aggregates industries and sorts by current total weight", () => {
    expect(aggregateIndustryWeights(holdingRows)).toEqual([
      { industry: "半導體業", weightPct: 19, stockCount: 2 },
      { industry: "未分類", weightPct: 3, stockCount: 1 },
    ]);
  });

  it("inserts null points on EXIT dates so re-entry history breaks", () => {
    expect(
      buildWeightHistory(
        [
          { tradeDate: "2026-07-01", weightPct: 2 },
          { tradeDate: "2026-07-10", weightPct: 3 },
        ],
        ["2026-07-05"],
      ),
    ).toEqual([
      { tradeDate: "2026-07-01", weightPct: 2 },
      { tradeDate: "2026-07-05", weightPct: null },
      { tradeDate: "2026-07-10", weightPct: 3 },
    ]);
  });

  it("resolves requested stock only from current holdings", () => {
    expect(resolveSelectedStockId(holdingRows, "2454")).toBe("2454");
    expect(resolveSelectedStockId(holdingRows, "9999")).toBe("2330");
    expect(resolveSelectedStockId([], "2330")).toBeNull();
  });

  it("sorts numeric fields with nulls last and stable stock-id tie breakers", () => {
    expect(sortHoldingRows(holdingRows, "holdingDays", "desc").map((row) => row.stockId)).toEqual([
      "2330",
      "2454",
      "US1",
    ]);
    expect(sortHoldingRows(holdingRows, "previousChange", "desc").map((row) => row.stockId)).toEqual([
      "US1",
      "2330",
      "2454",
    ]);
    expect(sortHoldingRows(holdingRows, "weightPct", "asc").map((row) => row.stockId)).toEqual([
      "US1",
      "2454",
      "2330",
    ]);
    expect(sortHoldingRows(holdingRows, "shares", "desc").map((row) => row.stockId)).toEqual([
      "2330",
      "2454",
      "US1",
    ]);
    expect(
      sortHoldingRows(holdingRows, "twentyDayChange", "desc").map((row) => row.stockId),
    ).toEqual(["US1", "2330", "2454"]);
    expect(sortHoldingRows(holdingRows, "holdingDays", "asc").map((row) => row.stockId)).toEqual([
      "2330",
      "2454",
      "US1",
    ]);
  });
});
