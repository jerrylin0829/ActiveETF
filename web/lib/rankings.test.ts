import { describe, expect, it } from "vitest";

import {
  buildPickingSummary,
  formatReturn,
  formatTurnover,
  formatWinRate,
  getReturnTone,
  pickLatestMetrics,
  sortRankings,
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
  });
});
