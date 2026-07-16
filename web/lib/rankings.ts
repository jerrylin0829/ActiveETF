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

export type DataGapWarning = {
  title: string;
  description: string;
};

export type ScrapeFailure = {
  etfId: string;
  tradeDate: string;
  runAt: string;
  error: string | null;
};

export type ScrapeLogEntry = ScrapeFailure & {
  status: "ok" | "fail";
};

export type DataGapInput = {
  etfs: Array<{ etfId: string; name: string }>;
  rows: RankingRow[];
  scrapeFailures: ScrapeFailure[];
};

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

export function getLatestTradeDate(rows: RankingRow[]): string | null {
  return rows.reduce<string | null>(
    (latest, row) => (latest === null || row.tradeDate > latest ? row.tradeDate : latest),
    null,
  );
}

function formatEtfList(items: string[]): string {
  const visible = items.slice(0, 5);
  const suffix = items.length > visible.length ? ` 等 ${items.length} 檔` : "";
  return `${visible.join("、")}${suffix}`;
}

export function latestUnresolvedScrapeFailures(logs: ScrapeLogEntry[]): ScrapeFailure[] {
  const latestByKey = new Map<string, ScrapeLogEntry>();
  const sortedLogs = [...logs].sort((a, b) => {
    const diff = Date.parse(b.runAt) - Date.parse(a.runAt);
    return Number.isNaN(diff) || diff === 0 ? b.runAt.localeCompare(a.runAt) : diff;
  });

  for (const log of sortedLogs) {
    const key = `${log.etfId}:${log.tradeDate}`;
    if (!latestByKey.has(key)) {
      latestByKey.set(key, log);
    }
  }

  return Array.from(latestByKey.values())
    .filter((log) => log.status === "fail")
    .map(({ etfId, tradeDate, runAt, error }) => ({ etfId, tradeDate, runAt, error }));
}

export function buildDataGapWarnings({
  etfs,
  rows,
  scrapeFailures,
}: DataGapInput): DataGapWarning[] {
  const warnings: DataGapWarning[] = [];
  const latestTradeDate = getLatestTradeDate(rows);
  const rowByEtf = new Map(rows.map((row) => [row.etfId, row]));

  if (latestTradeDate && etfs.length > 0) {
    const missingLatest = etfs
      .filter((etf) => rowByEtf.get(etf.etfId)?.tradeDate !== latestTradeDate)
      .map((etf) => `${etf.etfId} ${etf.name}`);

    if (missingLatest.length > 0) {
      warnings.push({
        title: "最新指標缺檔",
        description: `最新指標日期 ${latestTradeDate} 缺少 ${missingLatest.length} 檔 ETF：${formatEtfList(missingLatest)}。`,
      });
    }

    const staleRows = rows
      .filter((row) => row.tradeDate < latestTradeDate)
      .map((row) => `${row.etfId} ${row.tradeDate}`);

    if (staleRows.length > 0) {
      warnings.push({
        title: "部分 ETF 指標過期",
        description: `${staleRows.length} 檔 ETF 目前顯示舊資料：${formatEtfList(staleRows)}。`,
      });
    }
  }

  if (scrapeFailures.length > 0) {
    const failures = scrapeFailures.map(
      (failure) => `${failure.etfId} ${failure.tradeDate}：${failure.error ?? "未提供錯誤訊息"}`,
    );

    warnings.push({
      title: "近期爬蟲失敗",
      description: formatEtfList(failures) + "。",
    });
  }

  return warnings;
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
