import { describe, expect, it } from "vitest";

import {
  buildCollectiveMovements,
  buildOverviewDataGapWarnings,
  buildRadarNarratives,
  buildRadarPositions,
  filterChangeWall,
  formatWeightDelta,
  groupChangeWall,
  latestTradingWindow,
  rangeBounds,
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

  it("aggregates collective moves by ETF count before total value", () => {
    const result = buildCollectiveMovements([
      { ...baseEvent, etfId: "A", stockId: "2330", sharesDelta: 2000, changeType: "ADD", close: 1000 },
      { ...baseEvent, etfId: "B", stockId: "2330", sharesDelta: 1000, changeType: "NEW", close: 1000 },
      { ...baseEvent, etfId: "C", stockId: "3008", sharesDelta: 1000, changeType: "ADD", close: 4000 },
      { ...baseEvent, etfId: "D", stockId: "2303", sharesDelta: -4000, changeType: "TRIM", close: 50 },
      { ...baseEvent, etfId: "E", stockId: "2303", sharesDelta: -1000, changeType: "EXIT", close: 50 },
      { ...baseEvent, etfId: "F", stockId: "2317", sharesDelta: -1000, changeType: "TRIM", close: 120 },
    ]);

    expect(result.increases.map((item) => [item.stockId, item.etfCount, item.totalValueTwd])).toEqual([
      ["2330", 2, 3000000],
      ["3008", 1, 4000000],
    ]);
    expect(result.decreases.map((item) => [item.stockId, item.etfCount, item.totalValueTwd])).toEqual([
      ["2303", 2, -250000],
      ["2317", 1, -120000],
    ]);
  });

  it("sorts equal ETF counts by total value magnitude", () => {
    const result = buildCollectiveMovements([
      { ...baseEvent, etfId: "A", stockId: "2330", sharesDelta: 1000, close: 100 },
      { ...baseEvent, etfId: "B", stockId: "3008", sharesDelta: 1000, close: 500 },
    ]);

    expect(result.increases.map((item) => item.stockId)).toEqual(["3008", "2330"]);
  });

  it("propagates a missing close to the whole stock value and sorts it as zero", () => {
    const result = buildCollectiveMovements([
      { ...baseEvent, etfId: "A", stockId: "2330", sharesDelta: 1000, close: 100 },
      { ...baseEvent, etfId: "B", stockId: "2330", sharesDelta: 2000, close: null },
      { ...baseEvent, etfId: "C", stockId: "3008", sharesDelta: 1000, close: 1 },
      { ...baseEvent, etfId: "D", stockId: "3008", sharesDelta: 1000, close: 1 },
    ]);

    expect(result.increases.map((item) => [item.stockId, item.totalValueTwd])).toEqual([
      ["3008", 2000],
      ["2330", null],
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

  it("groups open positions by stock and orders ETF legs and follow-ups chronologically", () => {
    const positions = [
      {
        etfId: "B",
        etfName: "B 基金",
        issuer: "同一家",
        stockId: "2330",
        stockName: "台積電",
        industry: "半導體業",
        entryDate: "2026-07-10",
        holdingTradingDays: 2,
        sharedEtfCount: 2,
        sharedSignal: "2 檔 ETF 近期同步建倉",
        excessReturnPct: -12.2,
        excessReturnNote: null,
      },
      {
        etfId: "A",
        etfName: "A 基金",
        issuer: "同一家",
        stockId: "2330",
        stockName: "台積電",
        industry: "半導體業",
        entryDate: "2026-07-08",
        holdingTradingDays: 4,
        sharedEtfCount: 2,
        sharedSignal: "2 檔 ETF 近期同步建倉",
        excessReturnPct: 11.1,
        excessReturnNote: null,
      },
    ];
    const events: ChangeEvent[] = [
      { ...baseEvent, etfId: "B", etfName: "B 基金", issuer: "同一家", tradeDate: "2026-07-10", changeType: "NEW", sharesDelta: 10, close: 110 },
      { ...baseEvent, etfId: "A", etfName: "A 基金", issuer: "同一家", tradeDate: "2026-07-08", changeType: "NEW", sharesDelta: 20, close: 100 },
      { ...baseEvent, etfId: "A", etfName: "A 基金", issuer: "同一家", tradeDate: "2026-07-12", changeType: "TRIM", sharesDelta: -3, close: 120 },
      { ...baseEvent, etfId: "A", etfName: "A 基金", issuer: "同一家", tradeDate: "2026-07-09", changeType: "ADD", sharesDelta: 5, close: 105 },
      { ...baseEvent, etfId: "B", etfName: "B 基金", issuer: "同一家", tradeDate: "2026-07-11", changeType: "ADD", sharesDelta: 4, close: 115 },
    ];

    const narratives = buildRadarNarratives(positions, events);

    expect(narratives).toHaveLength(1);
    expect(narratives[0]).toMatchObject({
      stockId: "2330",
      stockName: "台積電",
      industry: "半導體業",
      etfCount: 2,
      issuerCount: 1,
      followUpCount: 2,
      entryValueTwd: 3100,
      addValueTwd: 985,
      segment: "multi_add",
    });
    expect(narratives[0].legs.map((leg) => leg.etfId)).toEqual(["A", "B"]);
    expect(narratives[0].legs[0].followUps.map((event) => [event.tradeDate, event.changeType])).toEqual([
      ["2026-07-09", "ADD"],
      ["2026-07-12", "TRIM"],
    ]);
  });

  it("classifies all four segments while TRIM remains context only", () => {
    const makePosition = (etfId: string, stockId: string, sharedEtfCount: number) => ({
      etfId,
      etfName: `${etfId} 基金`,
      issuer: etfId,
      stockId,
      stockName: stockId,
      industry: null,
      entryDate: "2026-07-10",
      holdingTradingDays: 2,
      sharedEtfCount,
      sharedSignal: sharedEtfCount >= 2 ? `${sharedEtfCount} 檔 ETF 近期同步建倉` : null,
      excessReturnPct: null,
      excessReturnNote: "不適用" as const,
    });
    const positions = [
      makePosition("A", "1000", 2),
      makePosition("B", "1000", 2),
      makePosition("C", "2000", 1),
      makePosition("D", "3000", 2),
      makePosition("E", "3000", 2),
      makePosition("F", "4000", 1),
    ];
    const events: ChangeEvent[] = positions.flatMap((position) => [
      { ...baseEvent, etfId: position.etfId, stockId: position.stockId, stockName: position.stockName, tradeDate: position.entryDate, changeType: "NEW" as const, close: 10 },
      ...(position.stockId === "1000" || position.stockId === "2000"
        ? [{ ...baseEvent, etfId: position.etfId, stockId: position.stockId, stockName: position.stockName, tradeDate: "2026-07-11", changeType: "ADD" as const, close: 10 }]
        : position.stockId === "3000"
          ? [{ ...baseEvent, etfId: position.etfId, stockId: position.stockId, stockName: position.stockName, tradeDate: "2026-07-11", changeType: "TRIM" as const, sharesDelta: -1, close: 10 }]
          : []),
    ]);

    const narratives = buildRadarNarratives(positions, events);

    expect(narratives.map((narrative) => [narrative.stockId, narrative.segment])).toEqual([
      ["1000", "multi_add"],
      ["3000", "multi_new"],
      ["2000", "single_add"],
      ["4000", "single_new"],
    ]);
    expect(narratives).toHaveLength(4);
    expect(narratives.find((narrative) => narrative.stockId === "3000")?.followUpCount).toBe(0);
  });

  it("uses event-day closes, propagates missing prices, and never sums excess returns", () => {
    const positions = [
      {
        etfId: "A",
        etfName: "A 基金",
        issuer: "甲",
        stockId: "2330",
        stockName: "台積電",
        industry: "半導體業",
        entryDate: "2026-07-10",
        holdingTradingDays: 2,
        sharedEtfCount: 1,
        sharedSignal: null,
        excessReturnPct: 15,
        excessReturnNote: null,
      },
    ];

    const [narrative] = buildRadarNarratives(positions, [
      { ...baseEvent, etfId: "A", tradeDate: "2026-07-10", changeType: "NEW", sharesDelta: 2, close: 100 },
      { ...baseEvent, etfId: "A", tradeDate: "2026-07-11", changeType: "ADD", sharesDelta: 3, close: null },
      { ...baseEvent, etfId: "A", tradeDate: "2026-07-12", changeType: "TRIM", sharesDelta: -1, close: 999 },
    ]);

    expect(narrative.entryValueTwd).toBe(200);
    expect(narrative.addValueTwd).toBeNull();
    expect(narrative.legs[0].excessReturnPct).toBe(15);
    expect(narrative).not.toHaveProperty("excessReturnPct");
  });

  it("keeps overseas amount estimates unavailable even without follow-up events", () => {
    const positions = [{
      etfId: "A",
      etfName: "全球基金",
      issuer: "甲",
      stockId: "NVDA US",
      stockName: "NVIDIA",
      industry: null,
      entryDate: "2026-07-10",
      holdingTradingDays: 2,
      sharedEtfCount: 1,
      sharedSignal: null,
      excessReturnPct: null,
      excessReturnNote: "不適用" as const,
    }];

    const [narrative] = buildRadarNarratives(positions, [
      { ...baseEvent, etfId: "A", stockId: "NVDA US", stockName: "NVIDIA", tradeDate: "2026-07-10", changeType: "NEW", close: null },
    ]);

    expect(narrative).toMatchObject({ entryValueTwd: null, addValueTwd: null });
  });

  it("keeps entry value unavailable when the matching NEW event is absent", () => {
    const positions = [{
      etfId: "A",
      etfName: "A 基金",
      issuer: "甲",
      stockId: "2330",
      stockName: "台積電",
      industry: "半導體業",
      entryDate: "2026-07-10",
      holdingTradingDays: 2,
      sharedEtfCount: 1,
      sharedSignal: null,
      excessReturnPct: 1,
      excessReturnNote: null,
    }];

    const [narrative] = buildRadarNarratives(positions, []);

    expect(narrative.entryValueTwd).toBeNull();
    expect(narrative.addValueTwd).toBe(0);
  });

  it("keeps follow-ups from an exited round out of a later NEW round", () => {
    const events: ChangeEvent[] = [
      { ...baseEvent, etfId: "A", tradeDate: "2026-07-01", changeType: "NEW", close: 80 },
      { ...baseEvent, etfId: "A", tradeDate: "2026-07-08", changeType: "EXIT", close: 90 },
      { ...baseEvent, etfId: "A", tradeDate: "2026-07-09", changeType: "ADD", close: 95 },
      { ...baseEvent, etfId: "A", tradeDate: "2026-07-10", changeType: "NEW", close: 100 },
      { ...baseEvent, etfId: "A", tradeDate: "2026-07-11", changeType: "ADD", close: 105 },
    ];
    const positions = buildRadarPositions(events, tradingDates, "2026-07-14");

    const [narrative] = buildRadarNarratives(positions, events);

    expect(narrative.legs[0].entryDate).toBe("2026-07-10");
    expect(narrative.legs[0].followUps).toEqual([
      { tradeDate: "2026-07-11", changeType: "ADD", sharesDelta: 1000, close: 105 },
    ]);
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

describe("rangeBounds", () => {
  it("當日起訖同為選定日期", () => {
    expect(rangeBounds("2026-07-22", "day")).toEqual({
      start: "2026-07-22",
      end: "2026-07-22",
    });
  });

  it("本週從週一至選定日期", () => {
    expect(rangeBounds("2026-07-22", "week")).toEqual({
      start: "2026-07-20",
      end: "2026-07-22",
    });
  });

  it("上週從上週一至上週五", () => {
    expect(rangeBounds("2026-07-22", "week_prev")).toEqual({
      start: "2026-07-13",
      end: "2026-07-17",
    });
  });

  it("本月從月初至選定日期", () => {
    expect(rangeBounds("2026-07-22", "month")).toEqual({
      start: "2026-07-01",
      end: "2026-07-22",
    });
  });

  it("上月從上月月初至上月月底", () => {
    expect(rangeBounds("2026-07-22", "month_prev")).toEqual({
      start: "2026-06-01",
      end: "2026-06-30",
    });
  });
});

describe("filterChangeWall", () => {
  const event = (overrides: Partial<ChangeEvent>): ChangeEvent => ({
    ...baseEvent,
    ...overrides,
  });
  const events = [
    event({ stockId: "2330", changeType: "NEW", weightDeltaPct: 0.5 }),
    event({ stockId: "2454", changeType: "EXIT", weightDeltaPct: -1.2 }),
    event({ stockId: "2317", changeType: "ADD", weightDeltaPct: 0.3 }),
    event({ stockId: "MRVL US", changeType: "NEW", weightDeltaPct: 0.8 }),
    event({ stockId: "2308", changeType: "TRIM", weightDeltaPct: -0.1 }),
  ];

  it("建倉出清與台股只留下 NEW/EXIT 並依權重幅度排序", () => {
    expect(
      filterChangeWall(events, "build_exit", "tw").map((item) => item.stockId),
    ).toEqual(["2454", "2330"]);
  });

  it("建倉出清與海外只留下海外事件", () => {
    expect(
      filterChangeWall(events, "build_exit", "overseas").map((item) => item.stockId),
    ).toEqual(["MRVL US"]);
  });

  it("加減碼與台股只留下 ADD/TRIM 並依權重幅度排序", () => {
    expect(
      filterChangeWall(events, "add_trim", "tw").map((item) => item.stockId),
    ).toEqual(["2317", "2308"]);
  });
});

describe("groupChangeWall", () => {
  const event = (overrides: Partial<ChangeEvent>): ChangeEvent => ({
    ...baseEvent,
    ...overrides,
  });
  const events = [
    event({ etfId: "A", stockId: "2330", stockName: "台積電", changeType: "NEW", sharesDelta: 4800000, weightDeltaPct: 0.6 }),
    event({ etfId: "B", stockId: "2330", stockName: "台積電", changeType: "EXIT", sharesDelta: -1500000, weightDeltaPct: -1.2 }),
    event({ etfId: "C", stockId: "2454", stockName: "聯發科", changeType: "NEW", sharesDelta: 100000, weightDeltaPct: 2.1 }),
    event({ etfId: "D", stockId: "2454", stockName: "聯發科", changeType: "NEW", sharesDelta: 200000, weightDeltaPct: 0.3 }),
    event({ etfId: "E", stockId: "2317", stockName: "鴻海", changeType: "NEW", sharesDelta: 500000, weightDeltaPct: 1.8 }),
    event({ etfId: "F", stockId: "MRVL US", stockName: "MRVL US", changeType: "NEW", sharesDelta: 1120, weightDeltaPct: 4 }),
    event({ etfId: "G", stockId: "2330", stockName: "台積電", changeType: "ADD", sharesDelta: 300000, weightDeltaPct: 3 }),
  ];

  it("filters before grouping and sorts each group by single-event weight impact", () => {
    const groups = groupChangeWall(events, "build_exit", "tw", "etf_count");

    expect(groups.map((group) => [group.stockId, group.etfCount, group.totalSharesDelta])).toEqual([
      ["2454", 2, 300000],
      ["2330", 2, 3300000],
      ["2317", 1, 500000],
    ]);
    expect(groups.find((group) => group.stockId === "2330")?.events.map((item) => item.etfId)).toEqual([
      "B",
      "A",
    ]);
  });

  it("switches group order to the largest single-event impact before ETF count", () => {
    const groups = groupChangeWall(events, "build_exit", "tw", "single_impact");

    expect(groups.map((group) => group.stockId)).toEqual(["2454", "2317", "2330"]);
  });

  it("keeps the market and event-tab scopes independent", () => {
    expect(groupChangeWall(events, "build_exit", "overseas", "etf_count").map((group) => group.stockId)).toEqual([
      "MRVL US",
    ]);
    expect(groupChangeWall(events, "add_trim", "tw", "etf_count").map((group) => group.stockId)).toEqual([
      "2330",
    ]);
  });
});
