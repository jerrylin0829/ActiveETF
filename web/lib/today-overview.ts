import type { DataGapWarning } from "@/lib/rankings";

export type ChangeType = "NEW" | "ADD" | "TRIM" | "EXIT";
export type OverviewRange = "day" | "week" | "week_prev" | "month" | "month_prev";

export type ChangeEvent = {
  etfId: string;
  etfName: string;
  issuer: string;
  tradeDate: string;
  stockId: string;
  stockName: string;
  changeType: ChangeType;
  sharesDelta: number;
  weightDeltaPct: number;
};

export type CollectiveMove = {
  stockId: string;
  stockName: string;
  etfCount: number;
  totalWeightDeltaPct: number;
};

export type CollectiveMovements = {
  increases: CollectiveMove[];
  decreases: CollectiveMove[];
};

export type OpenPositionRow = {
  etfId: string;
  stockId: string;
  entryDate: string;
  asOfDate: string;
  holdingDays: number;
  excessReturnPct: number | null;
};

export type RadarPosition = {
  etfId: string;
  etfName: string;
  issuer: string;
  stockId: string;
  stockName: string;
  entryDate: string;
  holdingTradingDays: number;
  sharedEtfCount: number;
  sharedSignal: string | null;
  excessReturnPct: number | null;
  // "—": 歷史日期或快取未涵蓋（買進至今報酬只提供最新交易日）；"不適用": 海外/缺價
  excessReturnNote: "不適用" | "—" | null;
};

export type RangeOption = {
  value: OverviewRange;
  label: string;
  href: string;
  active: boolean;
};

export type TodayOverviewViewModel = {
  selectedDate: string | null;
  availableDates: string[];
  range: OverviewRange;
  rangeOptions: RangeOption[];
  changeEvents: ChangeEvent[];
  collective: CollectiveMovements;
  radarPositions: RadarPosition[];
  warnings: DataGapWarning[];
  error: string | null;
};

export type ScrapeFailure = {
  etfId: string;
  etfName: string;
  tradeDate: string;
  error: string | null;
};

export function latestTradingWindow(
  tradingDates: string[],
  selectedDate: string,
  size = 20,
): string[] {
  return tradingDates
    .filter((date) => date <= selectedDate)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, size)
    .sort();
}

const changePriority: Record<ChangeType, number> = {
  NEW: 0,
  EXIT: 1,
  ADD: 2,
  TRIM: 3,
};

export function sortChangeEvents(events: ChangeEvent[]): ChangeEvent[] {
  return [...events].sort((a, b) => {
    const priorityDiff = changePriority[a.changeType] - changePriority[b.changeType];
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const weightDiff = Math.abs(b.weightDeltaPct) - Math.abs(a.weightDeltaPct);
    if (weightDiff !== 0) {
      return weightDiff;
    }

    return `${a.etfId}:${a.stockId}`.localeCompare(`${b.etfId}:${b.stockId}`);
  });
}

function roundWeight(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function sortCollectiveMoves(items: CollectiveMove[]): CollectiveMove[] {
  return items.sort((a, b) => {
    const countDiff = b.etfCount - a.etfCount;
    if (countDiff !== 0) {
      return countDiff;
    }

    const weightDiff = Math.abs(b.totalWeightDeltaPct) - Math.abs(a.totalWeightDeltaPct);
    if (weightDiff !== 0) {
      return weightDiff;
    }

    return a.stockId.localeCompare(b.stockId);
  });
}

function aggregateMoves(events: ChangeEvent[], types: ChangeType[]): CollectiveMove[] {
  const grouped = new Map<
    string,
    { stockName: string; etfIds: Set<string>; totalWeightDeltaPct: number }
  >();

  for (const event of events) {
    if (!types.includes(event.changeType)) {
      continue;
    }

    const current = grouped.get(event.stockId) ?? {
      stockName: event.stockName,
      etfIds: new Set<string>(),
      totalWeightDeltaPct: 0,
    };
    current.stockName = event.stockName;
    current.etfIds.add(event.etfId);
    current.totalWeightDeltaPct += event.weightDeltaPct;
    grouped.set(event.stockId, current);
  }

  return sortCollectiveMoves(
    Array.from(grouped, ([stockId, value]) => ({
      stockId,
      stockName: value.stockName,
      etfCount: value.etfIds.size,
      totalWeightDeltaPct: roundWeight(value.totalWeightDeltaPct),
    })),
  ).slice(0, 10);
}

export function buildCollectiveMovements(events: ChangeEvent[]): CollectiveMovements {
  return {
    increases: aggregateMoves(events, ["NEW", "ADD"]),
    decreases: aggregateMoves(events, ["TRIM", "EXIT"]),
  };
}

function holdingTradingDays(tradingDates: string[], entryDate: string, selectedDate: string): number {
  return tradingDates.filter((date) => date > entryDate && date <= selectedDate).length;
}

export function buildRadarPositions(
  events: ChangeEvent[],
  tradingDates: string[],
  selectedDate: string,
  openPositionRows: OpenPositionRow[] = [],
): RadarPosition[] {
  const cachedByRound = new Map(
    openPositionRows
      .filter((row) => row.asOfDate === selectedDate)
      .map((row) => [`${row.etfId}:${row.stockId}:${row.entryDate}`, row]),
  );
  const excessFor = (
    etfId: string,
    stockId: string,
    entryDate: string,
  ): Pick<RadarPosition, "excessReturnPct" | "excessReturnNote"> => {
    const key = `${etfId}:${stockId}:${entryDate}`;
    if (!cachedByRound.has(key)) {
      return { excessReturnPct: null, excessReturnNote: "—" };
    }
    const pct = cachedByRound.get(key)?.excessReturnPct ?? null;
    return pct === null
      ? { excessReturnPct: null, excessReturnNote: "不適用" }
      : { excessReturnPct: pct, excessReturnNote: null };
  };
  const openPositions = new Map<string, ChangeEvent>();
  const orderedEvents = [...events]
    .filter((event) => event.tradeDate <= selectedDate)
    .sort((a, b) => {
      const dateDiff = a.tradeDate.localeCompare(b.tradeDate);
      return dateDiff !== 0 ? dateDiff : `${a.etfId}:${a.stockId}`.localeCompare(`${b.etfId}:${b.stockId}`);
    });

  for (const event of orderedEvents) {
    const key = `${event.etfId}:${event.stockId}`;
    if (event.changeType === "NEW") {
      openPositions.set(key, event);
    }
    if (event.changeType === "EXIT") {
      openPositions.delete(key);
    }
  }

  const positions = Array.from(openPositions.values())
    .map((event) => {
      const cached = cachedByRound.get(`${event.etfId}:${event.stockId}:${event.tradeDate}`);
      return {
        etfId: event.etfId,
        etfName: event.etfName,
        issuer: event.issuer,
        stockId: event.stockId,
        stockName: event.stockName,
        entryDate: event.tradeDate,
        holdingTradingDays:
          cached?.holdingDays ?? holdingTradingDays(tradingDates, event.tradeDate, selectedDate),
        sharedEtfCount: 1,
        sharedSignal: null,
        ...excessFor(event.etfId, event.stockId, event.tradeDate),
      };
    })
    .filter((position) => position.holdingTradingDays >= 0 && position.holdingTradingDays < 20);

  const countByStock = new Map<string, number>();
  for (const position of positions) {
    countByStock.set(position.stockId, (countByStock.get(position.stockId) ?? 0) + 1);
  }

  return positions
    .map((position) => {
      const sharedEtfCount = countByStock.get(position.stockId) ?? 1;
      return {
        ...position,
        sharedEtfCount,
        sharedSignal:
          sharedEtfCount >= 2 ? `${sharedEtfCount} 檔 ETF 近期同步建倉` : null,
      };
    })
    .sort((a, b) => {
      const stockDiff = a.stockId.localeCompare(b.stockId);
      return stockDiff !== 0 ? stockDiff : a.etfId.localeCompare(b.etfId);
    });
}

function formatFailureList(failures: ScrapeFailure[]): string {
  const visible = failures.slice(0, 5).map((failure) => {
    const error = failure.error?.split("\n")[0] || "未提供錯誤訊息";
    return `${failure.etfId} ${failure.etfName}（${error}）`;
  });
  const suffix = failures.length > visible.length ? ` 等 ${failures.length} 檔` : "";
  return `${visible.join("、")}${suffix}`;
}

export function buildOverviewDataGapWarnings(failures: ScrapeFailure[]): DataGapWarning[] {
  if (failures.length === 0) {
    return [];
  }

  const tradeDate = failures[0]?.tradeDate ?? "選定日期";
  return [
    {
      title: "資料缺口",
      description: `${tradeDate} 有 ${failures.length} 檔 ETF 爬蟲失敗：${formatFailureList(failures)}。`,
    },
  ];
}

function addUtcDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function rangeBounds(
  selectedDate: string,
  range: OverviewRange,
): { start: string; end: string } {
  const date = new Date(`${selectedDate}T00:00:00Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;

  if (range === "day") {
    return { start: selectedDate, end: selectedDate };
  }
  if (range === "week") {
    return { start: addUtcDays(selectedDate, -mondayOffset), end: selectedDate };
  }
  if (range === "week_prev") {
    const thisMonday = addUtcDays(selectedDate, -mondayOffset);
    return {
      start: addUtcDays(thisMonday, -7),
      end: addUtcDays(thisMonday, -3),
    };
  }
  if (range === "month") {
    return { start: `${selectedDate.slice(0, 7)}-01`, end: selectedDate };
  }

  const previousMonthEnd = addUtcDays(`${selectedDate.slice(0, 7)}-01`, -1);
  return {
    start: `${previousMonthEnd.slice(0, 7)}-01`,
    end: previousMonthEnd,
  };
}

export function formatSharesDelta(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("zh-TW")}`;
}

export function formatWeightDelta(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}
