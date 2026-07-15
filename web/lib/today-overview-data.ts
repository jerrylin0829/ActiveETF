import { createReadOnlySupabaseClient } from "@/lib/supabase";
import {
  buildCollectiveMovements,
  buildOverviewDataGapWarnings,
  buildRadarPositions,
  latestTradingWindow,
  sortChangeEvents,
  type ChangeEvent,
  type ChangeType,
  type OverviewRange,
  type RangeOption,
  type ScrapeFailure,
  type TodayOverviewViewModel,
} from "@/lib/today-overview";

type EtfRelation = { name: string; issuer: string } | { name: string; issuer: string }[] | null;

type HoldingChangeRecord = {
  etf_id: string;
  trade_date: string;
  stock_id: string;
  change_type: ChangeType;
  shares_delta: number | string;
  weight_delta_pct: number | string;
  etf: EtfRelation;
};

type StockInfoRecord = {
  stock_id: string;
  name: string;
};

type EtfRecord = {
  etf_id: string;
  name: string;
};

type ScrapeAttemptRecord = {
  id: number | string;
  etf_id: string;
  trade_date: string;
  run_at: string;
  status: "ok" | "fail";
  error: string | null;
};

type DateRecord = {
  trade_date: string;
};

const pageSize = 1000;
const changeSelect = `
  etf_id,
  trade_date,
  stock_id,
  change_type,
  shares_delta,
  weight_delta_pct,
  etf(name, issuer)
`;
const radarWindowSize = 20;

function toNumber(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function relatedEtf(value: EtfRelation): { name: string; issuer: string } | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

async function fetchPaged<T>(
  loadPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: string | null }> {
  const records: T[] = [];
  let page = 0;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await loadPage(from, to);

    if (error) {
      return { data: records, error: error.message };
    }

    const pageRecords = (data ?? []) as T[];
    records.push(...pageRecords);

    if (pageRecords.length < pageSize) {
      return { data: records, error: null };
    }

    page += 1;
  }
}

function descendingDates(records: DateRecord[]): string[] {
  return records.map((record) => record.trade_date).sort((a, b) => b.localeCompare(a));
}

function latestFailedScrapeAttempts(records: ScrapeAttemptRecord[]): ScrapeAttemptRecord[] {
  const latestByEtfAndDate = new Map<string, ScrapeAttemptRecord>();

  for (const record of records) {
    const key = `${record.etf_id}:${record.trade_date}`;
    const current = latestByEtfAndDate.get(key);
    const newerRun = !current || record.run_at > current.run_at;
    const sameRunWithNewerId = current
      && record.run_at === current.run_at
      && BigInt(record.id) > BigInt(current.id);

    if (newerRun || sameRunWithNewerId) {
      latestByEtfAndDate.set(key, record);
    }
  }

  return Array.from(latestByEtfAndDate.values()).filter((record) => record.status === "fail");
}

function normalizeRange(value: string | undefined): OverviewRange {
  return value === "week" || value === "month" ? value : "day";
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeStartDate(selectedDate: string, range: OverviewRange): string {
  if (range === "day") {
    return selectedDate;
  }

  const date = new Date(`${selectedDate}T00:00:00Z`);
  if (range === "week") {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    return toDateString(addDays(date, -mondayOffset));
  }

  return `${selectedDate.slice(0, 7)}-01`;
}

function buildRangeOptions(selectedDate: string | null, range: OverviewRange): RangeOption[] {
  const dateQuery = selectedDate ? `date=${encodeURIComponent(selectedDate)}&` : "";
  const options: Array<{ value: OverviewRange; label: string }> = [
    { value: "day", label: "當日" },
    { value: "week", label: "本週" },
    { value: "month", label: "本月" },
  ];

  return options.map((option) => ({
    ...option,
    href: `/?${dateQuery}range=${option.value}`,
    active: option.value === range,
  }));
}

function mapChangeRecord(record: HoldingChangeRecord, stockNames: Map<string, string>): ChangeEvent {
  const etf = relatedEtf(record.etf);
  return {
    etfId: record.etf_id,
    etfName: etf?.name ?? record.etf_id,
    issuer: etf?.issuer ?? "未提供",
    tradeDate: record.trade_date,
    stockId: record.stock_id,
    stockName: stockNames.get(record.stock_id) ?? record.stock_id,
    changeType: record.change_type,
    sharesDelta: toNumber(record.shares_delta),
    weightDeltaPct: toNumber(record.weight_delta_pct),
  };
}

async function fetchStockNames(stockIds: string[]): Promise<{ data: Map<string, string>; error: string | null }> {
  if (stockIds.length === 0) {
    return { data: new Map(), error: null };
  }

  const supabase = createReadOnlySupabaseClient();
  const { data, error } = await supabase
    .from("stock_info")
    .select("stock_id, name")
    .in("stock_id", stockIds);

  if (error) {
    return { data: new Map(), error: error.message };
  }

  return {
    data: new Map(((data ?? []) as StockInfoRecord[]).map((record) => [record.stock_id, record.name])),
    error: null,
  };
}

export async function fetchTodayOverview({
  date,
  range: rangeParam,
}: {
  date?: string;
  range?: string;
} = {}): Promise<TodayOverviewViewModel> {
  const supabase = createReadOnlySupabaseClient();
  const dateResult = await fetchPaged<DateRecord>((from, to) =>
    supabase
      .from("dashboard_holding_change_dates")
      .select("trade_date")
      .order("trade_date", { ascending: false })
      .range(from, to),
  );
  const availableDates = descendingDates(dateResult.data);
  const selectedDate = date && availableDates.includes(date) ? date : (availableDates[0] ?? null);
  const range = normalizeRange(rangeParam);

  if (!selectedDate) {
    return {
      selectedDate,
      availableDates,
      range,
      rangeOptions: buildRangeOptions(selectedDate, range),
      changeEvents: [],
      collective: { increases: [], decreases: [] },
      radarPositions: [],
      warnings: [],
      error: dateResult.error,
    };
  }

  const startDate = rangeStartDate(selectedDate, range);
  const { data: tradingDateData, error: tradingDatesError } = await supabase
    .from("dashboard_holding_snapshot_dates")
    .select("trade_date")
    .lte("trade_date", selectedDate)
    .order("trade_date", { ascending: false })
    .limit(radarWindowSize);
  const tradingDatesResult = {
    data: (tradingDateData ?? []) as DateRecord[],
    error: tradingDatesError?.message ?? null,
  };
  const radarTradingDates = latestTradingWindow(
    descendingDates(tradingDatesResult.data),
    selectedDate,
    radarWindowSize,
  );
  const radarStartDate = radarTradingDates[0] ?? selectedDate;
  const [
    selectedChangesResult,
    rangeChangesResult,
    radarChangesResult,
    scrapeFailuresResult,
    etfsResult,
  ] = await Promise.all([
    fetchPaged<HoldingChangeRecord>((from, to) =>
      supabase
        .from("holding_change")
        .select(changeSelect)
        .eq("trade_date", selectedDate)
        .order("trade_date", { ascending: true })
        .order("etf_id", { ascending: true })
        .order("stock_id", { ascending: true })
        .range(from, to),
    ),
    fetchPaged<HoldingChangeRecord>((from, to) =>
      supabase
        .from("holding_change")
        .select(changeSelect)
        .gte("trade_date", startDate)
        .lte("trade_date", selectedDate)
        .order("trade_date", { ascending: true })
        .order("etf_id", { ascending: true })
        .order("stock_id", { ascending: true })
        .range(from, to),
    ),
    fetchPaged<HoldingChangeRecord>((from, to) =>
      supabase
        .from("holding_change")
        .select(changeSelect)
        .in("change_type", ["NEW", "EXIT"])
        .gte("trade_date", radarStartDate)
        .lte("trade_date", selectedDate)
        .order("trade_date", { ascending: true })
        .order("etf_id", { ascending: true })
        .order("stock_id", { ascending: true })
        .range(from, to),
    ),
    fetchPaged<ScrapeAttemptRecord>((from, to) =>
      supabase
        .from("scrape_log")
        .select("id, etf_id, trade_date, run_at, status, error")
        .eq("trade_date", selectedDate)
        .order("run_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    ),
    supabase.from("etf").select("etf_id, name"),
  ]);

  const allChangeRecords = [
    ...selectedChangesResult.data,
    ...rangeChangesResult.data,
    ...radarChangesResult.data,
  ];
  const stockIds = Array.from(new Set(allChangeRecords.map((record) => record.stock_id)));
  const stockNamesResult = await fetchStockNames(stockIds);
  const stockNames = stockNamesResult.data;

  const selectedEvents = sortChangeEvents(
    selectedChangesResult.data.map((record) => mapChangeRecord(record, stockNames)),
  );
  const rangeEvents = rangeChangesResult.data.map((record) => mapChangeRecord(record, stockNames));
  const radarEvents = radarChangesResult.data.map((record) => mapChangeRecord(record, stockNames));
  const etfNames = new Map(
    (((etfsResult.data ?? []) as EtfRecord[]).map((record) => [record.etf_id, record.name])),
  );
  const scrapeFailures = latestFailedScrapeAttempts(scrapeFailuresResult.data).map(
    (failure): ScrapeFailure => ({
      etfId: failure.etf_id,
      etfName: etfNames.get(failure.etf_id) ?? failure.etf_id,
      tradeDate: failure.trade_date,
      error: failure.error,
    }),
  );
  const errors = [
    dateResult.error,
    tradingDatesResult.error,
    selectedChangesResult.error,
    rangeChangesResult.error,
    radarChangesResult.error,
    scrapeFailuresResult.error,
    etfsResult.error?.message,
    stockNamesResult.error,
  ].filter(Boolean);

  return {
    selectedDate,
    availableDates,
    range,
    rangeOptions: buildRangeOptions(selectedDate, range),
    changeEvents: selectedEvents,
    collective: buildCollectiveMovements(rangeEvents),
    radarPositions: buildRadarPositions(
      radarEvents,
      radarTradingDates,
      selectedDate,
    ),
    warnings: buildOverviewDataGapWarnings(scrapeFailures),
    error: errors.length > 0 ? errors.join("；") : null,
  };
}
