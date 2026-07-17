import { describe, expect, it } from "vitest";
import {
  buildRotationSeries,
  buildRotationTable,
  filterByRange,
  filterRotationChartRange,
  topIndustries,
  type IndustryDaily,
} from "@/lib/rotation";

const d = (date: string, industry: string, sum: number, etfs = 2): IndustryDaily => ({
  tradeDate: date,
  industry,
  sumWeightPct: sum,
  stockCount: 3,
  etfCountTotal: etfs,
});

const raw = [
  d("2026-07-10", "半導體業", 80),
  d("2026-07-10", "金融保險業", 20),
  d("2026-07-11", "半導體業", 84),
  d("2026-07-11", "金融保險業", 16),
  d("2026-07-14", "半導體業", 90),
  d("2026-07-14", "金融保險業", 10),
];

describe("buildRotationSeries", () => {
  it("平均權重 = sum / etf_count_total，依日期排序", () => {
    const series = buildRotationSeries(raw);
    expect(series.dates).toEqual(["2026-07-10", "2026-07-11", "2026-07-14"]);
    expect(series.byIndustry["半導體業"]).toEqual([40, 42, 45]);
  });

  it("有效彙總日缺少產業 row 時視為 0，之後可重新出現", () => {
    const series = buildRotationSeries([
      d("2026-07-10", "半導體業", 20),
      d("2026-07-10", "金融保險業", 10),
      d("2026-07-11", "金融保險業", 12),
      d("2026-07-14", "半導體業", 10),
      d("2026-07-14", "金融保險業", 14),
    ]);

    expect(series.byIndustry["半導體業"]).toEqual([10, 0, 5]);
    const semi = buildRotationTable(series, { shortDays: 2, longDays: 20 }).find(
      (row) => row.industry === "半導體業",
    );
    expect(semi?.shortChangePct).toBe(-5);
  });
});

describe("topIndustries", () => {
  it("依最新一日平均權重取前 N 大", () => {
    expect(topIndustries(buildRotationSeries(raw), 1)).toEqual(["半導體業"]);
  });
});

describe("buildRotationTable", () => {
  it("N 日變化 = 最新平均 − N 個交易日前平均（不足 N 日為 null）", () => {
    const table = buildRotationTable(buildRotationSeries(raw), { shortDays: 2, longDays: 20 });
    const semi = table.find((r) => r.industry === "半導體業")!;
    expect(semi.latestAvgPct).toBe(45);
    expect(semi.shortChangePct).toBe(5); // 45 - 40 (2 trading days back)
    expect(semi.longChangePct).toBeNull(); // fewer than 20 rows
    expect(semi.stockCount).toBe(3);
  });
  it("依當日平均權重降冪排序", () => {
    const table = buildRotationTable(buildRotationSeries(raw), { shortDays: 2, longDays: 20 });
    expect(table.map((r) => r.industry)).toEqual(["半導體業", "金融保險業"]);
  });
});

describe("filterByRange", () => {
  it("依起始日裁切序列", () => {
    const cut = filterByRange(buildRotationSeries(raw), "2026-07-11");
    expect(cut.dates).toEqual(["2026-07-11", "2026-07-14"]);
    expect(cut.byIndustry["半導體業"]).toEqual([42, 45]);
  });
  it("起始日早於全部資料時原樣返回", () => {
    const series = buildRotationSeries(raw);
    expect(filterByRange(series, "2020-01-01")).toEqual(series);
  });
});

describe("filterRotationChartRange", () => {
  it("1M 圖表裁切曆月範圍但保留完整序列供 20 交易日計算", () => {
    const dates = [
      "2026-01-19",
      "2026-01-21",
      "2026-01-22",
      "2026-01-23",
      "2026-01-26",
      "2026-01-27",
      "2026-01-28",
      "2026-01-29",
      "2026-01-30",
      "2026-02-02",
      "2026-02-03",
      "2026-02-04",
      "2026-02-05",
      "2026-02-06",
      "2026-02-09",
      "2026-02-10",
      "2026-02-11",
      "2026-02-12",
      "2026-02-13",
      "2026-02-19",
      "2026-02-20",
    ];
    const fullSeries = buildRotationSeries(
      dates.map((date, index) => d(date, "半導體業", 20 + index, 1)),
    );

    const chartSeries = filterRotationChartRange(fullSeries, "1M");
    const table = buildRotationTable(fullSeries, { shortDays: 5, longDays: 20 });

    expect(chartSeries.dates[0]).toBe("2026-01-21");
    expect(chartSeries.dates).not.toContain("2026-01-19");
    expect(table[0]?.longChangePct).toBe(20);
  });
});
