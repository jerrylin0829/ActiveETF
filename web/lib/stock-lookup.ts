import type { DataGapWarning } from "@/lib/rankings";

export type StockLookupRange = "1M" | "3M" | "6M" | "all";
export type StockChangeType = "NEW" | "ADD" | "TRIM" | "EXIT";

export type StockHolderSnapshot = {
  etfId: string;
  shares: number;
  weightPct: number;
};

export type StockOpenPosition = {
  etfId: string;
  entryDate: string;
  asOfDate: string;
  holdingDays: number;
};

export type StockHolderRow = {
  etfId: string;
  etfName: string;
  shares: number;
  weightPct: number;
  changeType: StockChangeType | null;
  entryDate: string | null;
  holdingDays: number | null;
  isLongHeld: boolean;
};

export type StockTrendPoint = {
  tradeDate: string;
  totalWeightPct: number;
  etfCount: number;
};

export type StockChangeEvent = {
  tradeDate: string;
  etfId: string;
  etfName: string;
  changeType: StockChangeType;
  sharesDelta: number;
  weightDeltaPct: number;
};

export type StockLookupViewModel = {
  stockId: string;
  stockName: string;
  industry: string;
  latestDate: string | null;
  latestEtfCount: number;
  holders: StockHolderRow[];
  trend: StockTrendPoint[];
  events: StockChangeEvent[];
  warnings: DataGapWarning[];
  error: string | null;
};

export type StockLookupResult =
  | { found: false; error: string | null }
  | { found: true; detail: StockLookupViewModel };

export function buildStockHolderRows({
  holdings,
  etfNames,
  changes,
  openPositions,
}: {
  holdings: StockHolderSnapshot[];
  etfNames: Map<string, string>;
  changes: Map<string, StockChangeType>;
  openPositions: StockOpenPosition[];
}): StockHolderRow[] {
  const latestPositions = new Map<string, StockOpenPosition>();
  for (const position of openPositions) {
    const current = latestPositions.get(position.etfId);
    if (!current || position.entryDate > current.entryDate) {
      latestPositions.set(position.etfId, position);
    }
  }

  return holdings
    .map((holding) => {
      const position = latestPositions.get(holding.etfId);
      return {
        ...holding,
        etfName: etfNames.get(holding.etfId) ?? holding.etfId,
        changeType: changes.get(holding.etfId) ?? null,
        entryDate: position?.entryDate ?? null,
        holdingDays: position?.holdingDays ?? null,
        isLongHeld: (position?.holdingDays ?? -1) >= 20,
      };
    })
    .sort((left, right) => right.weightPct - left.weightPct || left.etfId.localeCompare(right.etfId));
}

export function normalizeStockLookupRange(value: string | undefined): StockLookupRange {
  return value === "1M" || value === "6M" || value === "all" ? value : "3M";
}

function rangeStartDate(latestDate: string, range: Exclude<StockLookupRange, "all">): string {
  const months = range === "1M" ? 1 : range === "3M" ? 3 : 6;
  const date = new Date(`${latestDate}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

export function filterStockTrendRange(
  points: StockTrendPoint[],
  range: StockLookupRange,
): StockTrendPoint[] {
  if (range === "all" || points.length === 0) return points;
  const startDate = rangeStartDate(points.at(-1)!.tradeDate, range);
  return points.filter((point) => point.tradeDate >= startDate);
}
