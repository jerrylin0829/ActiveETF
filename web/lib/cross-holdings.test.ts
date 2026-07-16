import { describe, expect, it } from "vitest";
import {
  applyFilters,
  sortRows,
  type CoverageFilter,
  type CrossRow,
} from "@/lib/cross-holdings";

const row = (over: Partial<CrossRow>): CrossRow => ({
  stockId: "2330",
  stockName: "台積電",
  industry: "半導體業",
  etfCount: 3,
  totalWeightPct: 20,
  totalShares: 1000,
  totalValueTwd: null,
  newCount: 0,
  addCount: 0,
  trimCount: 0,
  exitCount: 0,
  ...over,
});

describe("sortRows", () => {
  it("預設涵蓋檔數降冪、次鍵合計權重降冪", () => {
    const rows = [
      row({ stockId: "A", etfCount: 2, totalWeightPct: 9 }),
      row({ stockId: "B", etfCount: 5, totalWeightPct: 1 }),
      row({ stockId: "C", etfCount: 5, totalWeightPct: 8 }),
    ];
    expect(sortRows(rows, { key: "etfCount", desc: true }).map((r) => r.stockId))
      .toEqual(["C", "B", "A"]);
  });
  it("可依任一數值欄排序", () => {
    const rows = [row({ stockId: "A", totalShares: 5 }), row({ stockId: "B", totalShares: 9 })];
    expect(sortRows(rows, { key: "totalShares", desc: true })[0].stockId).toBe("B");
  });
  it("null 金額排在降冪最後", () => {
    const rows = [
      row({ stockId: "A", totalValueTwd: null }),
      row({ stockId: "B", totalValueTwd: 100 }),
    ];
    expect(sortRows(rows, { key: "totalValueTwd", desc: true })[0].stockId).toBe("B");
  });
});

describe("applyFilters", () => {
  const rows = [
    row({ stockId: "A", etfCount: 1, industry: "水泥工業" }),
    row({ stockId: "B", etfCount: 3, industry: "半導體業", addCount: 1 }),
    row({ stockId: "C", etfCount: 5, industry: "半導體業" }),
  ];
  it("獨門 = 涵蓋檔數恰為 1", () => {
    expect(applyFilters(rows, { coverage: "only1", industries: [], changedOnly: false })
      .map((r) => r.stockId)).toEqual(["A"]);
  });
  it("涵蓋檔數下限 + 產業 + 只看異動可疊加", () => {
    const f = { coverage: "min2" as CoverageFilter, industries: ["半導體業"], changedOnly: true };
    expect(applyFilters(rows, f).map((r) => r.stockId)).toEqual(["B"]);
  });
});
