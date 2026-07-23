import { describe, expect, it } from "vitest";

import {
  buildCollectiveMovements,
  buildOverviewDataGapWarnings,
  buildRadarPositions,
  formatWeightDelta,
  latestTradingWindow,
  sortChangeEvents,
  type ChangeEvent,
} from "@/lib/today-overview";

const baseEvent: ChangeEvent = {
  etfId: "00980A",
  etfName: "主動野村臺灣優選",
  issuer: "野村",
  tradeDate: "2026-07-14",
  stockId: "2330",
  stockName: "台積電",
  changeType: "ADD",
  sharesDelta: 1000,
  weightDeltaPct: 0.12,
};

describe("today overview change events", () => {
  it("sorts NEW and EXIT before ADD and TRIM", () => {
    const sorted = sortChangeEvents([
      { ...baseEvent, changeType: "TRIM", stockId: "2317", sharesDelta: -1000 },
      { ...baseEvent, changeType: "ADD", stockId: "2330" },
      { ...baseEvent, changeType: "EXIT", stockId: "2303", sharesDelta: -5000 },
      { ...baseEvent, changeType: "NEW", stockId: "3008", sharesDelta: 3000 },
    ]);

    expect(sorted.map((event) => event.changeType)).toEqual(["NEW", "EXIT", "ADD", "TRIM"]);
  });

  it("aggregates collective moves by ETF count before total weight delta", () => {
    const result = buildCollectiveMovements([
      { ...baseEvent, etfId: "A", stockId: "2330", weightDeltaPct: 0.2, changeType: "ADD" },
      { ...baseEvent, etfId: "B", stockId: "2330", weightDeltaPct: 0.1, changeType: "NEW" },
      { ...baseEvent, etfId: "C", stockId: "3008", weightDeltaPct: 0.9, changeType: "ADD" },
      { ...baseEvent, etfId: "D", stockId: "2303", weightDeltaPct: -1.1, changeType: "TRIM" },
      { ...baseEvent, etfId: "E", stockId: "2303", weightDeltaPct: -0.2, changeType: "EXIT" },
      { ...baseEvent, etfId: "F", stockId: "2317", weightDeltaPct: -2.5, changeType: "TRIM" },
    ]);

    expect(result.increases.map((item) => [item.stockId, item.etfCount, item.totalWeightDeltaPct])).toEqual([
      ["2330", 2, 0.3],
      ["3008", 1, 0.9],
    ]);
    expect(result.decreases.map((item) => [item.stockId, item.etfCount, item.totalWeightDeltaPct])).toEqual([
      ["2303", 2, -1.3],
      ["2317", 1, -2.5],
    ]);
  });
});

describe("today overview radar", () => {
  const tradingDates = [
    "2026-06-17",
    "2026-06-18",
    "2026-06-19",
    "2026-06-22",
    "2026-06-23",
    "2026-06-24",
    "2026-06-25",
    "2026-06-26",
    "2026-06-29",
    "2026-06-30",
    "2026-07-01",
    "2026-07-02",
    "2026-07-03",
    "2026-07-06",
    "2026-07-07",
    "2026-07-08",
    "2026-07-09",
    "2026-07-10",
    "2026-07-13",
    "2026-07-14",
  ];

  it("keeps open NEW positions under 20 trading days and marks shared entries", () => {
    const positions = buildRadarPositions(
      [
        { ...baseEvent, etfId: "A", stockId: "2330", tradeDate: "2026-07-10", changeType: "NEW" },
        { ...baseEvent, etfId: "B", stockId: "2330", tradeDate: "2026-07-13", changeType: "NEW" },
        { ...baseEvent, etfId: "C", stockId: "2317", tradeDate: "2026-07-01", changeType: "NEW" },
        { ...baseEvent, etfId: "C", stockId: "2317", tradeDate: "2026-07-08", changeType: "EXIT" },
        { ...baseEvent, etfId: "D", stockId: "3008", tradeDate: "2026-06-17", changeType: "NEW" },
      ],
      tradingDates,
      "2026-07-14",
    );

    expect(positions.map((position) => [position.etfId, position.stockId])).toEqual([
      ["A", "2330"],
      ["B", "2330"],
      ["D", "3008"],
    ]);
    expect(positions[0]).toMatchObject({
      holdingTradingDays: 2,
      sharedEtfCount: 2,
      sharedSignal: "2 檔 ETF 近期同步建倉",
      excessReturnPct: null,
      excessReturnNote: "—", // no open_position rows supplied
    });
  });

  it("joins excess returns from open_position when viewing the as-of date", () => {
    const positions = buildRadarPositions(
      [
        { ...baseEvent, etfId: "A", stockId: "2330", tradeDate: "2026-07-10", changeType: "NEW" },
        { ...baseEvent, etfId: "B", stockId: "9999", tradeDate: "2026-07-13", changeType: "NEW" },
      ],
      tradingDates,
      "2026-07-14",
      [
        { etfId: "A", stockId: "2330", entryDate: "2026-07-10",
          asOfDate: "2026-07-14", holdingDays: 2, excessReturnPct: 12.334 },
        { etfId: "B", stockId: "9999", entryDate: "2026-07-13",
          asOfDate: "2026-07-14", holdingDays: 1, excessReturnPct: null }, // foreign/unpriceable
      ],
    );

    expect(positions.find((p) => p.etfId === "A")).toMatchObject({
      holdingTradingDays: 2,
      excessReturnPct: 12.334,
      excessReturnNote: null,
    });
    expect(positions.find((p) => p.etfId === "B")).toMatchObject({
      excessReturnPct: null,
      excessReturnNote: "不適用",
    });
  });

  it("shows a dash instead of stale excess returns on historical dates", () => {
    const positions = buildRadarPositions(
      [{ ...baseEvent, etfId: "A", stockId: "2330", tradeDate: "2026-07-10", changeType: "NEW" }],
      tradingDates,
      "2026-07-13", // browsing an earlier date than the cache's as-of
      [{ etfId: "A", stockId: "2330", entryDate: "2026-07-10",
         asOfDate: "2026-07-14", holdingDays: 2, excessReturnPct: 3.2 }],
    );

    expect(positions[0]).toMatchObject({ excessReturnPct: null, excessReturnNote: "—" });
  });

  it("treats entry day as day 0 and keeps it in the radar", () => {
    const positions = buildRadarPositions(
      [{ ...baseEvent, etfId: "A", stockId: "2486", tradeDate: "2026-07-14", changeType: "NEW" }],
      tradingDates,
      "2026-07-14",
      [{ etfId: "A", stockId: "2486", entryDate: "2026-07-14",
         asOfDate: "2026-07-14", holdingDays: 0, excessReturnPct: 0 }],
    );

    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ holdingTradingDays: 0, excessReturnPct: 0 });
  });

  it("keeps day 19 and excludes day 20 using pipeline holding_days", () => {
    const events = [
      { ...baseEvent, etfId: "A", stockId: "2330", tradeDate: "2026-06-17", changeType: "NEW" as const },
      { ...baseEvent, etfId: "B", stockId: "2317", tradeDate: "2026-06-18", changeType: "NEW" as const },
    ];
    const positions = buildRadarPositions(events, tradingDates, "2026-07-14", [
      { etfId: "A", stockId: "2330", entryDate: "2026-06-17",
        asOfDate: "2026-07-14", holdingDays: 20, excessReturnPct: 1 },
      { etfId: "B", stockId: "2317", entryDate: "2026-06-18",
        asOfDate: "2026-07-14", holdingDays: 19, excessReturnPct: 2 },
    ]);

    expect(positions.map((position) => [position.etfId, position.holdingTradingDays])).toEqual([
      ["B", 19],
    ]);
  });

  it("excludes open NEW positions once they reach 20 trading days", () => {
    const positions = buildRadarPositions(
      [{ ...baseEvent, etfId: "A", stockId: "3008", tradeDate: "2026-06-16", changeType: "NEW" }],
      tradingDates,
      "2026-07-14",
    );

    expect(positions).toEqual([]);
  });

  it("excludes NEW positions that EXIT inside the 20-trading-day window", () => {
    const positions = buildRadarPositions(
      [
        { ...baseEvent, etfId: "A", stockId: "2330", tradeDate: "2026-07-10", changeType: "NEW" },
        { ...baseEvent, etfId: "A", stockId: "2330", tradeDate: "2026-07-14", changeType: "EXIT" },
      ],
      tradingDates,
      "2026-07-14",
    );

    expect(positions).toEqual([]);
  });

  it("builds the 20-day trading window relative to the historical selected date", () => {
    expect(latestTradingWindow(tradingDates, "2026-07-08", 5)).toEqual([
      "2026-07-02",
      "2026-07-03",
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
    ]);
  });

  it("keeps the radar trading window bounded when the database has longer history", () => {
    const longHistory = Array.from({ length: 120 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 1 + index));
      return date.toISOString().slice(0, 10);
    });
    const selectedDate = longHistory[79];

    const window = latestTradingWindow(longHistory, selectedDate);

    expect(window).toHaveLength(20);
    expect(window[0]).toBe(longHistory[60]);
    expect(window.at(-1)).toBe(selectedDate);
  });
});

describe("today overview data gaps", () => {
  it("builds selected-date scrape failure warnings with ETF names", () => {
    expect(
      buildOverviewDataGapWarnings([
        {
          etfId: "00987A",
          etfName: "台新優勢成長",
          tradeDate: "2026-07-14",
          error: "ValidationError: empty holdings",
        },
      ]),
    ).toEqual([
      {
        title: "資料缺口",
        description: "2026-07-14 有 1 檔 ETF 爬蟲失敗：00987A 台新優勢成長（ValidationError: empty holdings）。",
      },
    ]);
  });
});

describe("formatWeightDelta", () => {
  it("以百分比呈現、兩位小數並帶正負號", () => {
    expect(formatWeightDelta(0.05)).toBe("+0.05%");
    expect(formatWeightDelta(1.2345)).toBe("+1.23%");
    expect(formatWeightDelta(-0.866)).toBe("-0.87%");
    expect(formatWeightDelta(0)).toBe("+0.00%");
  });
});
