export type IndustryDaily = {
  tradeDate: string;
  industry: string;
  sumWeightPct: number;
  stockCount: number;
  etfCountTotal: number;
};

export type RotationSeries = {
  dates: string[]; // ascending trade dates
  byIndustry: Record<string, (number | null)[]>; // avg weight % aligned to dates
  stockCounts: Record<string, number>; // latest-day stock count per industry
  latestEtfCountTotal: number;
};

export type RotationTableRow = {
  industry: string;
  latestAvgPct: number;
  shortChangePct: number | null;
  longChangePct: number | null;
  stockCount: number;
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function buildRotationSeries(rows: IndustryDaily[]): RotationSeries {
  const dates = [...new Set(rows.map((r) => r.tradeDate))].sort();
  const index = new Map(dates.map((date, i) => [date, i]));
  const byIndustry: Record<string, (number | null)[]> = {};
  const stockCounts: Record<string, number> = {};
  let latestEtfCountTotal = 0;
  for (const r of rows) {
    const arr = (byIndustry[r.industry] ??= Array(dates.length).fill(null));
    arr[index.get(r.tradeDate)!] =
      r.etfCountTotal > 0 ? round2(r.sumWeightPct / r.etfCountTotal) : null;
    if (r.tradeDate === dates[dates.length - 1]) {
      stockCounts[r.industry] = r.stockCount;
      latestEtfCountTotal = r.etfCountTotal;
    }
  }
  return { dates, byIndustry, stockCounts, latestEtfCountTotal };
}

export function topIndustries(series: RotationSeries, n: number): string[] {
  const last = series.dates.length - 1;
  return Object.entries(series.byIndustry)
    .map(([industry, values]) => ({ industry, latest: values[last] ?? -Infinity }))
    .sort((a, b) => b.latest - a.latest)
    .slice(0, n)
    .map((e) => e.industry);
}

export function buildRotationTable(
  series: RotationSeries,
  { shortDays, longDays }: { shortDays: number; longDays: number },
): RotationTableRow[] {
  const last = series.dates.length - 1;
  const changeOver = (values: (number | null)[], days: number): number | null => {
    const prev = last - days >= 0 ? values[last - days] : null;
    const curr = values[last];
    return prev === null || prev === undefined || curr === null || curr === undefined
      ? null
      : round2(curr - prev);
  };
  return Object.entries(series.byIndustry)
    .map(([industry, values]) => ({
      industry,
      latestAvgPct: values[last] ?? 0,
      shortChangePct: changeOver(values, shortDays),
      longChangePct: changeOver(values, longDays),
      stockCount: series.stockCounts[industry] ?? 0,
    }))
    .sort((a, b) => b.latestAvgPct - a.latestAvgPct);
}

export function filterByRange(series: RotationSeries, fromDate: string): RotationSeries {
  const startIdx = series.dates.findIndex((date) => date >= fromDate);
  if (startIdx <= 0) return series;
  return {
    ...series,
    dates: series.dates.slice(startIdx),
    byIndustry: Object.fromEntries(
      Object.entries(series.byIndustry).map(([k, v]) => [k, v.slice(startIdx)]),
    ),
  };
}
