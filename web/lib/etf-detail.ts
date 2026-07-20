import type { DataGapWarning, RankingRow, SortDirection } from "@/lib/rankings";

export type SnapshotHolding = {
  stockId: string;
  shares: number;
  weightPct: number;
};

export type StockMetadata = {
  name: string;
  industry: string | null;
};

export type OpenPositionValue = {
  stockId: string;
  entryDate: string;
  holdingDays: number;
  asOfDate?: string;
};

export type HoldingChangeValue = number | "NEW" | null;

export type EtfHoldingRow = {
  stockId: string;
  stockName: string;
  industry: string;
  shares: number;
  weightPct: number;
  previousChange: HoldingChangeValue;
  twentyDayChange: number | null;
  entryDate: string | null;
  holdingDays: number | null;
  isLongHeld: boolean;
};

export type HoldingSortField =
  | "weightPct"
  | "previousChange"
  | "twentyDayChange"
  | "shares"
  | "holdingDays";

export type IndustryWeight = {
  industry: string;
  weightPct: number;
  stockCount: number;
};

export type WeightHistoryRecord = {
  tradeDate: string;
  weightPct: number;
};

export type WeightHistoryPoint = {
  tradeDate: string;
  weightPct: number | null;
};

export type EtfChangeType = "NEW" | "ADD" | "TRIM" | "EXIT";

export type EtfChangeEvent = {
  tradeDate: string;
  stockId: string;
  stockName: string;
  changeType: EtfChangeType;
  sharesDelta: number;
  weightDeltaPct: number;
};

export type EtfDetailViewModel = {
  etfId: string;
  name: string;
  issuer: string;
  latestDate: string | null;
  previousDate: string | null;
  twentyDayDate: string | null;
  metric: RankingRow | null;
  holdings: EtfHoldingRow[];
  industries: IndustryWeight[];
  changes: EtfChangeEvent[];
  selectedStockId: string | null;
  selectedStockName: string | null;
  weightHistory: WeightHistoryPoint[];
  warnings: DataGapWarning[];
  error: string | null;
};

export type EtfDetailResult =
  | { found: false; error: string | null }
  | { found: true; detail: EtfDetailViewModel };

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function latestPositionsByStock(
  positions: OpenPositionValue[],
): Map<string, OpenPositionValue> {
  const latest = new Map<string, OpenPositionValue>();
  for (const position of positions) {
    const current = latest.get(position.stockId);
    if (!current || position.entryDate > current.entryDate) {
      latest.set(position.stockId, position);
    }
  }
  return latest;
}

export function buildHoldingRows({
  current,
  previous,
  twentyDaysAgo,
  stockInfo,
  openPositions,
}: {
  current: SnapshotHolding[];
  previous: SnapshotHolding[] | null;
  twentyDaysAgo: SnapshotHolding[] | null;
  stockInfo: Map<string, StockMetadata>;
  openPositions: OpenPositionValue[];
}): EtfHoldingRow[] {
  const previousWeights = previous === null
    ? null
    : new Map(previous.map((holding) => [holding.stockId, holding.weightPct]));
  const twentyDayWeights = twentyDaysAgo === null
    ? null
    : new Map(twentyDaysAgo.map((holding) => [holding.stockId, holding.weightPct]));
  const positions = latestPositionsByStock(openPositions);

  const rows = current.map((holding): EtfHoldingRow => {
    const metadata = stockInfo.get(holding.stockId);
    const position = positions.get(holding.stockId);
    const previousWeight = previousWeights?.get(holding.stockId);
    const twentyDayWeight = twentyDayWeights?.get(holding.stockId);
    const previousChange = previousWeights === null
      ? null
      : previousWeight === undefined
        ? "NEW"
        : round4(holding.weightPct - previousWeight);
    const twentyDayChange = twentyDayWeights === null
      ? null
      : round4(holding.weightPct - (twentyDayWeight ?? 0));
    const holdingDays = position?.holdingDays ?? null;

    return {
      stockId: holding.stockId,
      stockName: metadata?.name || holding.stockId,
      industry: metadata?.industry || "未分類",
      shares: holding.shares,
      weightPct: holding.weightPct,
      previousChange,
      twentyDayChange,
      entryDate: position?.entryDate ?? null,
      holdingDays,
      isLongHeld: holdingDays !== null && holdingDays >= 20,
    };
  });

  return sortHoldingRows(rows, "weightPct", "desc");
}

export function aggregateIndustryWeights(rows: EtfHoldingRow[]): IndustryWeight[] {
  const totals = new Map<string, IndustryWeight>();
  for (const row of rows) {
    const current = totals.get(row.industry) ?? {
      industry: row.industry,
      weightPct: 0,
      stockCount: 0,
    };
    current.weightPct = round4(current.weightPct + row.weightPct);
    current.stockCount += 1;
    totals.set(row.industry, current);
  }

  return Array.from(totals.values()).sort(
    (left, right) => right.weightPct - left.weightPct || left.industry.localeCompare(right.industry),
  );
}

export function buildWeightHistory(
  records: WeightHistoryRecord[],
  exitDates: string[],
): WeightHistoryPoint[] {
  const points = new Map<string, number | null>();
  for (const record of records) {
    points.set(record.tradeDate, record.weightPct);
  }
  for (const exitDate of exitDates) {
    points.set(exitDate, null);
  }

  return Array.from(points, ([tradeDate, weightPct]) => ({ tradeDate, weightPct })).sort(
    (left, right) => left.tradeDate.localeCompare(right.tradeDate),
  );
}

export function resolveSelectedStockId(
  rows: EtfHoldingRow[],
  requestedStockId?: string,
): string | null {
  if (requestedStockId && rows.some((row) => row.stockId === requestedStockId)) {
    return requestedStockId;
  }
  return rows[0]?.stockId ?? null;
}

function sortableValue(row: EtfHoldingRow, field: HoldingSortField): number | null {
  if (field === "previousChange") {
    return row.previousChange === "NEW" ? row.weightPct : row.previousChange;
  }
  return row[field];
}

export function sortHoldingRows(
  rows: EtfHoldingRow[],
  field: HoldingSortField,
  direction: SortDirection,
): EtfHoldingRow[] {
  return [...rows].sort((left, right) => {
    const leftValue = sortableValue(left, field);
    const rightValue = sortableValue(right, field);
    if (leftValue === null && rightValue === null) {
      return left.stockId.localeCompare(right.stockId);
    }
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    const difference = leftValue - rightValue;
    if (difference === 0) return left.stockId.localeCompare(right.stockId);
    return direction === "asc" ? difference : -difference;
  });
}
