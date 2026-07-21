import {
  buildStockHolderRows,
  type StockChangeEvent,
  type StockChangeType,
  type StockHolderSnapshot,
  type StockLookupResult,
  type StockOpenPosition,
  type StockTrendPoint,
} from "@/lib/stock-lookup";
import {
  latestUnresolvedScrapeFailures,
  type DataGapWarning,
  type ScrapeLogEntry,
} from "@/lib/rankings";
import { createReadOnlySupabaseClient } from "@/lib/supabase";

type DateRecord = { trade_date: string };
type SnapshotRecord = {
  etf_id: string;
  trade_date: string;
  stock_id: string;
  shares: number | string;
  weight_pct: number | string;
};
type TrendRecord = {
  trade_date: string;
  stock_id: string;
  etf_count: number;
  total_weight_pct: number | string;
};
type ChangeRecord = {
  etf_id: string;
  trade_date: string;
  stock_id: string;
  change_type: StockChangeType;
  shares_delta: number | string;
  weight_delta_pct: number | string;
};
type OpenPositionRecord = {
  etf_id: string;
  stock_id: string;
  entry_date: string;
  as_of_date: string;
  holding_days: number;
};
type EtfRecord = { etf_id: string; name: string };
type StockInfoRecord = { stock_id: string; name: string; industry: string | null };
type ScrapeLogRecord = {
  etf_id: string;
  trade_date: string;
  run_at: string;
  status: "ok" | "fail";
  error: string | null;
};

const pageSize = 1000;
const idChunkSize = 200;
const eventTradingDays = 30;
const scrapeLogLimit = 250;

function toNumber(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) return { data: records, error: error.message };
    const batch = (data ?? []) as T[];
    records.push(...batch);
    if (batch.length < pageSize) return { data: records, error: null };
    page += 1;
  }
}

async function fetchEtfs(
  supabase: ReturnType<typeof createReadOnlySupabaseClient>,
  etfIds: string[],
): Promise<{ data: EtfRecord[]; error: string | null }> {
  if (etfIds.length === 0) return { data: [], error: null };
  const chunks = Array.from(
    { length: Math.ceil(etfIds.length / idChunkSize) },
    (_, index) => etfIds.slice(index * idChunkSize, (index + 1) * idChunkSize),
  );
  const results = await Promise.all(chunks.map((chunk) =>
    supabase
      .from("etf")
      .select("etf_id, name")
      .in("etf_id", chunk)
      .order("etf_id", { ascending: true }),
  ));
  const errors = results.map((result) => result.error?.message).filter(Boolean);
  return {
    data: results.flatMap((result) => (result.data ?? []) as EtfRecord[]),
    error: errors.length > 0 ? errors.join("；") : null,
  };
}

function buildWarnings({
  stockId,
  stockLatestDate,
  globalLatestDate,
  scrapeLogs,
  openPositions,
}: {
  stockId: string;
  stockLatestDate: string;
  globalLatestDate: string | null;
  scrapeLogs: ScrapeLogRecord[];
  openPositions: OpenPositionRecord[];
}): DataGapWarning[] {
  const warnings: DataGapWarning[] = [];
  if (globalLatestDate && stockLatestDate < globalLatestDate) {
    warnings.push({
      title: "個股資料尚未更新",
      description: `${stockId} 最新持股資料為 ${stockLatestDate}，全站最新交易日為 ${globalLatestDate}。`,
    });
  }

  const failures = latestUnresolvedScrapeFailures(
    scrapeLogs.map((record): ScrapeLogEntry => ({
      etfId: record.etf_id,
      tradeDate: record.trade_date,
      runAt: record.run_at,
      status: record.status,
      error: record.error,
    })),
  );
  if (failures.length > 0) {
    warnings.push({
      title: "近期爬蟲失敗",
      description: failures
        .slice(0, 5)
        .map((failure) => `${failure.etfId} ${failure.tradeDate}：${failure.error ?? "未提供錯誤訊息"}`)
        .join("；"),
    });
  }

  const stalePositions = openPositions.filter((position) => position.as_of_date < stockLatestDate);
  if (stalePositions.length > 0) {
    warnings.push({
      title: "持有天數快取尚未更新",
      description: `${stalePositions.length} 筆 open_position 早於個股最新資料 ${stockLatestDate}。`,
    });
  }
  return warnings;
}

export async function fetchStockLookup(stockId: string): Promise<StockLookupResult> {
  const supabase = createReadOnlySupabaseClient();
  const { data: existenceData, error: existenceError } = await supabase
    .from("holdings_snapshot")
    .select("stock_id, trade_date, etf_id")
    .eq("stock_id", stockId)
    .order("trade_date", { ascending: false })
    .order("etf_id", { ascending: true })
    .limit(1);
  if ((existenceData ?? []).length === 0) {
    return { found: false, error: existenceError?.message ?? null };
  }

  const snapshotLatestDate = (existenceData as Pick<SnapshotRecord, "trade_date">[])[0].trade_date;
  const [globalDateQuery, trendResult, stockInfoQuery, scrapeQuery] = await Promise.all([
    supabase
      .from("dashboard_holding_snapshot_dates")
      .select("trade_date")
      .order("trade_date", { ascending: false })
      .limit(eventTradingDays),
    fetchPaged<TrendRecord>((from, to) =>
      supabase
        .from("cross_holdings_daily")
        .select("trade_date, stock_id, etf_count, total_weight_pct")
        .eq("stock_id", stockId)
        .order("trade_date", { ascending: true })
        .order("stock_id", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("stock_info")
      .select("stock_id, name, industry")
      .eq("stock_id", stockId)
      .limit(1),
    supabase
      .from("scrape_log")
      .select("etf_id, trade_date, run_at, status, error")
      .order("run_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(scrapeLogLimit),
  ]);

  const globalDates = ((globalDateQuery.data ?? []) as DateRecord[]).map((record) => record.trade_date);
  const globalLatestDate = globalDates[0] ?? null;
  const stockLatestDate = trendResult.data.at(-1)?.trade_date ?? snapshotLatestDate;
  const eventStart = globalDates.at(-1) ?? null;
  const eventEnd = globalLatestDate ?? stockLatestDate;
  const stockInfo = ((stockInfoQuery.data ?? []) as StockInfoRecord[])[0];
  const [holdingResult, changeResult] = await Promise.all([
    fetchPaged<SnapshotRecord>((from, to) =>
      supabase
        .from("holdings_snapshot")
        .select("etf_id, trade_date, stock_id, shares, weight_pct")
        .eq("trade_date", stockLatestDate)
        .eq("stock_id", stockId)
        .order("trade_date", { ascending: true })
        .order("etf_id", { ascending: true })
        .order("stock_id", { ascending: true })
        .range(from, to),
    ),
    eventStart
      ? fetchPaged<ChangeRecord>((from, to) =>
          supabase
            .from("holding_change")
            .select("etf_id, trade_date, stock_id, change_type, shares_delta, weight_delta_pct")
            .eq("stock_id", stockId)
            .gte("trade_date", eventStart)
            .lte("trade_date", eventEnd)
            .order("trade_date", { ascending: false })
            .order("etf_id", { ascending: true })
            .order("stock_id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as ChangeRecord[], error: null }),
  ]);

  const holderEtfIds = Array.from(new Set(holdingResult.data.map((record) => record.etf_id))).sort();
  const allEtfIds = Array.from(new Set([
    ...holderEtfIds,
    ...changeResult.data.map((record) => record.etf_id),
  ])).sort();
  const [etfResult, positionResult] = await Promise.all([
    fetchEtfs(supabase, allEtfIds),
    holderEtfIds.length > 0
      ? fetchPaged<OpenPositionRecord>((from, to) =>
          supabase
            .from("open_position")
            .select("etf_id, stock_id, entry_date, as_of_date, holding_days")
            .eq("stock_id", stockId)
            .in("etf_id", holderEtfIds)
            .order("etf_id", { ascending: true })
            .order("stock_id", { ascending: true })
            .order("entry_date", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as OpenPositionRecord[], error: null }),
  ]);

  const etfNames = new Map(etfResult.data.map((record) => [record.etf_id, record.name]));
  const changes = new Map<string, StockChangeType>();
  for (const record of changeResult.data) {
    if (record.trade_date === stockLatestDate) changes.set(record.etf_id, record.change_type);
  }
  const holdings: StockHolderSnapshot[] = holdingResult.data.map((record) => ({
    etfId: record.etf_id,
    shares: toNumber(record.shares),
    weightPct: toNumber(record.weight_pct),
  }));
  const openPositions: StockOpenPosition[] = positionResult.data.map((record) => ({
    etfId: record.etf_id,
    entryDate: record.entry_date,
    asOfDate: record.as_of_date,
    holdingDays: record.holding_days,
  }));
  const trend: StockTrendPoint[] = trendResult.data.map((record) => ({
    tradeDate: record.trade_date,
    totalWeightPct: toNumber(record.total_weight_pct),
    etfCount: record.etf_count,
  }));
  const events: StockChangeEvent[] = changeResult.data.map((record) => ({
    tradeDate: record.trade_date,
    etfId: record.etf_id,
    etfName: etfNames.get(record.etf_id) ?? record.etf_id,
    changeType: record.change_type,
    sharesDelta: toNumber(record.shares_delta),
    weightDeltaPct: toNumber(record.weight_delta_pct),
  }));
  const latestTrend = trend.find((point) => point.tradeDate === stockLatestDate);
  const errors = [
    existenceError?.message,
    globalDateQuery.error?.message,
    trendResult.error,
    stockInfoQuery.error?.message,
    scrapeQuery.error?.message,
    holdingResult.error,
    changeResult.error,
    etfResult.error,
    positionResult.error,
  ].filter(Boolean);

  return {
    found: true,
    detail: {
      stockId,
      stockName: stockInfo?.name || stockId,
      industry: stockInfo?.industry || "未分類",
      latestDate: stockLatestDate,
      latestEtfCount: latestTrend?.etfCount ?? holdings.length,
      holders: buildStockHolderRows({ holdings, etfNames, changes, openPositions }),
      trend,
      events,
      warnings: buildWarnings({
        stockId,
        stockLatestDate,
        globalLatestDate,
        scrapeLogs: (scrapeQuery.data ?? []) as ScrapeLogRecord[],
        openPositions: positionResult.data,
      }),
      error: errors.length > 0 ? errors.join("；") : null,
    },
  };
}
