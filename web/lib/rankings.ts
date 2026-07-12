export type ReturnField = "ret1m" | "ret3m" | "ret6m" | "ret1y" | "retInception";
export type SortField =
  | ReturnField
  | "timingRate"
  | "pickingRealizedRate"
  | "pickingOpenRate"
  | "medianHoldingDays"
  | "weeklyTurnoverPct";
export type SortDirection = "asc" | "desc";
export type ReturnTone = "beat-positive" | "beat-negative" | "neutral";

export type RankingRow = {
  etfId: string;
  name: string;
  issuer: string;
  tradeDate: string;
  ret1m: number | null;
  ret3m: number | null;
  ret6m: number | null;
  ret1y: number | null;
  retInception: number | null;
  bench00501m: number | null;
  bench00503m: number | null;
  bench00506m: number | null;
  bench00501y: number | null;
  timingWins: number;
  timingMonths: number;
  pickingRealizedWins: number;
  pickingRealizedTotal: number;
  pickingOpenWins: number;
  pickingOpenTotal: number;
  medianHoldingDays: number | null;
  weeklyTurnoverPct: number | null;
};

const returnBenchmarks: Partial<Record<ReturnField, keyof RankingRow>> = {
  ret1m: "bench00501m",
  ret3m: "bench00503m",
  ret6m: "bench00506m",
  ret1y: "bench00501y",
};

export function formatReturn(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  const percent = value * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

export function formatTurnover(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  return `${value.toFixed(1)}%`;
}

export function formatNumber(value: number | null, suffix = ""): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  return `${value.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}${suffix}`;
}

export function formatWinRate(wins: number, total: number): string {
  if (total <= 0) {
    return `—（${wins}/${total}）`;
  }

  return `${Math.round((wins / total) * 100)}%（${wins}/${total}）`;
}

export function buildPickingSummary(wins: number, total: number): {
  label: string;
  insufficient: boolean;
} {
  return {
    label: formatWinRate(wins, total),
    insufficient: total > 0 && total < 10,
  };
}

export function winRateValue(wins: number, total: number): number | null {
  return total > 0 ? wins / total : null;
}

export function getReturnTone(row: RankingRow, field: ReturnField): ReturnTone {
  const benchmarkField = returnBenchmarks[field];
  if (!benchmarkField) {
    return "neutral";
  }

  const value = row[field];
  const benchmark = row[benchmarkField];
  if (typeof value !== "number" || typeof benchmark !== "number" || value <= benchmark) {
    return "neutral";
  }

  return value >= 0 ? "beat-positive" : "beat-negative";
}

export function pickLatestMetrics(rows: RankingRow[]): RankingRow[] {
  const latest = new Map<string, RankingRow>();

  for (const row of rows) {
    const current = latest.get(row.etfId);
    if (!current || row.tradeDate > current.tradeDate) {
      latest.set(row.etfId, row);
    }
  }

  return Array.from(latest.values()).sort((a, b) => a.etfId.localeCompare(b.etfId));
}

function sortValue(row: RankingRow, field: SortField): number | null {
  if (field === "timingRate") {
    return winRateValue(row.timingWins, row.timingMonths);
  }
  if (field === "pickingRealizedRate") {
    return winRateValue(row.pickingRealizedWins, row.pickingRealizedTotal);
  }
  if (field === "pickingOpenRate") {
    return winRateValue(row.pickingOpenWins, row.pickingOpenTotal);
  }

  return row[field];
}

export function sortRankings(
  rows: RankingRow[],
  field: SortField,
  direction: SortDirection,
): RankingRow[] {
  return [...rows].sort((a, b) => {
    const av = sortValue(a, field);
    const bv = sortValue(b, field);

    if (av === null && bv === null) {
      return a.etfId.localeCompare(b.etfId);
    }
    if (av === null) {
      return 1;
    }
    if (bv === null) {
      return -1;
    }

    const diff = av - bv;
    if (diff === 0) {
      return a.etfId.localeCompare(b.etfId);
    }

    return direction === "asc" ? diff : -diff;
  });
}
