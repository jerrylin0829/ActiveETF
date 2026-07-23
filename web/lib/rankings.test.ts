import { describe, expect, it } from "vitest";

import {
  buildDataGapWarnings,
  buildPickingSummary,
  formatReturn,
  formatTurnover,
  formatWinRate,
  getLatestTradeDate,
  getReturnTone,
  latestUnresolvedScrapeFailures,
  pickLatestMetrics,
  sortRankings,
  type DataGapInput,
  type RankingRow,
} from "@/lib/rankings";

const baseRow: RankingRow = {
  etfId: "00980A",
  name: "主動野村臺灣優選",
  issuer: "野村投信",
  tradeDate: "2026-07-10",
  ret1m: 0.042,
  ret3m: null,
  ret6m: null,
  ret1y: null,
  retInception: 0.086,
  bench00501m: 0.018,
  bench00503m: null,
  bench00506m: null,
  bench00501y: null,
  bench0050Inception: 0.05,
  timingWins: 8,
  timingMonths: 12,
  pickingRealizedWins: 6,
  pickingRealizedTotal: 8,
  pickingOpenWins: 7,
  pickingOpenTotal: 12,
  medianHoldingDays: 18,
  weeklyTurnoverPct: 4.8,
};

describe("ranking formatting", () => {
  it("formats fractional returns and missing periods", () => {
    expect(formatReturn(0.0345)).toBe("+3.45%");
    expect(formatReturn(-0.012)).toBe("-1.20%");
    expect(formatReturn(null)).toBe("—");
  });

  it("formats win rates with samples", () => {
    expect(formatWinRate(8, 12)).toBe("67%（8/12）");
    expect(formatWinRate(0, 0)).toBe("—（0/0）");
  });

  it("marks picking samples below ten as insufficient", () => {
    expect(buildPickingSummary(6, 8)).toEqual({
      label: "75%（6/8）",
      insufficient: true,
    });
    expect(buildPickingSummary(7, 12)).toEqual({
      label: "58%（7/12）",
      insufficient: false,
    });
  });

  it("formats weekly turnover as an already-percent value", () => {
    expect(formatTurnover(4.8)).toBe("4.8%");
    expect(formatTurnover(null)).toBe("—");
  });
});

describe("ranking row shaping", () => {
  it("keeps only the latest metrics row for each ETF", () => {
    const rows = pickLatestMetrics([
      { ...baseRow, tradeDate: "2026-07-09", ret1m: 0.01 },
      { ...baseRow, tradeDate: "2026-07-10", ret1m: 0.03 },
      { ...baseRow, etfId: "00981A", tradeDate: "2026-07-08", ret1m: 0.02 },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.etfId === "00980A")?.ret1m).toBe(0.03);
  });

  it("sorts numeric fields with nulls last", () => {
    const rows = sortRankings(
      [
        { ...baseRow, etfId: "A", ret1m: null },
        { ...baseRow, etfId: "B", ret1m: -0.01 },
        { ...baseRow, etfId: "C", ret1m: 0.05 },
      ],
      "ret1m",
      "desc",
    );

    expect(rows.map((row) => row.etfId)).toEqual(["C", "B", "A"]);
  });

  it("only colors returns when they beat the matching benchmark", () => {
    expect(getReturnTone({ ...baseRow, ret1m: 0.04, bench00501m: 0.02 }, "ret1m")).toBe(
      "beat-positive",
    );
    expect(getReturnTone({ ...baseRow, ret1m: -0.01, bench00501m: -0.03 }, "ret1m")).toBe(
      "beat-negative",
    );
    expect(getReturnTone({ ...baseRow, ret1m: 0.01, bench00501m: 0.02 }, "ret1m")).toBe(
      "neutral",
    );
    expect(
      getReturnTone(
        { ...baseRow, retInception: 0.08, bench0050Inception: 0.05 },
        "retInception",
      ),
    ).toBe("beat-positive");
  });

  it("finds the max trade date independent of ETF-id sorting", () => {
    expect(
      getLatestTradeDate([
        { ...baseRow, etfId: "00999A", tradeDate: "2026-07-09" },
        { ...baseRow, etfId: "00400A", tradeDate: "2026-07-11" },
      ]),
    ).toBe("2026-07-11");
  });
});

describe("data gap warnings", () => {
  const gapInput: DataGapInput = {
    etfs: [
      { etfId: "00400A", name: "主動國泰動能高息" },
      { etfId: "00401A", name: "主動摩根台灣鑫收" },
      { etfId: "00402A", name: "主動安聯美國科技" },
    ],
    rows: [
      { ...baseRow, etfId: "00400A", name: "主動國泰動能高息", tradeDate: "2026-07-12" },
      { ...baseRow, etfId: "00401A", name: "主動摩根台灣鑫收", tradeDate: "2026-07-10" },
    ],
    scrapeFailures: [
      {
        etfId: "00402A",
        tradeDate: "2026-07-12",
        runAt: "2026-07-12T11:30:00+00:00",
        error: "PCF 解析失敗",
      },
    ],
  };

  it("reports missing, stale, and scrape-failure gaps", () => {
    expect(buildDataGapWarnings(gapInput)).toEqual([
      {
        title: "最新指標缺檔",
        description: "最新指標日期 2026-07-12 缺少 2 檔 ETF：00401A 主動摩根台灣鑫收、00402A 主動安聯美國科技。",
      },
      {
        title: "部分 ETF 指標過期",
        description: "1 檔 ETF 目前顯示舊資料：00401A 2026-07-10。",
      },
      {
        title: "近期爬蟲失敗",
        description: "00402A 2026-07-12：PCF 解析失敗。",
      },
    ]);
  });

  it("does not report gaps when every ETF has current metrics and no scrape failures", () => {
    expect(
      buildDataGapWarnings({
        etfs: [{ etfId: "00400A", name: "主動國泰動能高息" }],
        rows: [{ ...baseRow, etfId: "00400A", name: "主動國泰動能高息" }],
        scrapeFailures: [],
      }),
    ).toEqual([]);
  });

  it("ignores scrape failures resolved by a later ok log for the same ETF/date", () => {
    expect(
      latestUnresolvedScrapeFailures([
        {
          etfId: "00987A",
          tradeDate: "2026-07-14",
          runAt: "2026-07-14T11:56:07Z",
          status: "fail",
          error: "ValidationError: empty holdings",
        },
        {
          etfId: "00987A",
          tradeDate: "2026-07-14",
          runAt: "2026-07-14T15:08:39Z",
          status: "ok",
          error: null,
        },
      ]),
    ).toEqual([]);
  });

  it("keeps scrape failures when the latest log for that ETF/date is still fail", () => {
    expect(
      latestUnresolvedScrapeFailures([
        {
          etfId: "00987A",
          tradeDate: "2026-07-14",
          runAt: "2026-07-14T15:08:39Z",
          status: "ok",
          error: null,
        },
        {
          etfId: "00987A",
          tradeDate: "2026-07-15",
          runAt: "2026-07-15T11:56:07Z",
          status: "fail",
          error: "ValidationError: empty holdings",
        },
      ]),
    ).toEqual([
      {
        etfId: "00987A",
        tradeDate: "2026-07-15",
        runAt: "2026-07-15T11:56:07Z",
        error: "ValidationError: empty holdings",
      },
    ]);
  });
});
