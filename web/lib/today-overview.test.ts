import { describe, expect, it } from "vitest";

import {
  buildCollectiveMovements,
  buildOverviewDataGapWarnings,
  buildRadarPositions,
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
    ]);
    expect(positions[0]).toMatchObject({
      holdingTradingDays: 3,
      sharedEtfCount: 2,
      sharedSignal: "2 檔 ETF 近期同步建倉",
      excessReturnLabel: "待上線",
    });
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
