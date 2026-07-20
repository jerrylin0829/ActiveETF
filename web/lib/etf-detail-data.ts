import { createReadOnlySupabaseClient } from "@/lib/supabase";
import {
  aggregateIndustryWeights,
  buildHoldingRows,
  buildWeightHistory,
  resolveSelectedStockId,
  type EtfChangeEvent,
  type EtfChangeType,
  type EtfDetailResult,
  type OpenPositionValue,
  type SnapshotHolding,
  type StockMetadata,
  type WeightHistoryRecord,
} from "@/lib/etf-detail";
import {
  mapMetricRecord,
  rankingMetricSelect,
  type MetricRecord,
} from "@/lib/rankings-data";
import {
  latestUnresolvedScrapeFailures,
  type DataGapWarning,
  type ScrapeLogEntry,
} from "@/lib/rankings";

type EtfRecord = {
  etf_id: string;
  name: string;
  issuer: string;
  listed_date: string | null;
};

type DateRecord = { trade_date: string };

type SnapshotRecord = {
  etf_id: string;
  trade_date: string;
  stock_id: string;
  shares: number | string;
  weight_pct: number | string;
};

type OpenPositionRecord = {
  etf_id: string;
  stock_id: string;
  entry_date: string;
  as_of_date: string;
  holding_days: number;
};

type ChangeRecord = {
  etf_id: string;
  trade_date: string;
  stock_id: string;
  change_type: EtfChangeType;
  shares_delta: number | string;
  weight_delta_pct: number | string;
};

type ScrapeLogRecord = {
  etf_id: string;
  trade_date: string;
  run_at: string;
  status: "ok" | "fail";
  error: string | null;
};

type StockInfoRecord = {
  stock_id: string;
  name: string;
  industry: string | null;
};

const pageSize = 1000;
const dateChunkSize = 40;
const timelineTradingDays = 30;
const stockInfoChunkSize = 200;
const scrapeLogLimit = 250;

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

async function discoverEtfTradingDates(
  supabase: ReturnType<typeof createReadOnlySupabaseClient>,
  etfId: string,
  listedDate: string | null,
): Promise<{ dates: string[]; globalLatestDate: string | null; error: string | null }> {
  const found = new Set<string>();
  const errors: string[] = [];
  let globalLatestDate: string | null = null;
  let datePage = 0;

  while (found.size < timelineTradingDays) {
    const from = datePage * dateChunkSize;
    let dateQuery = supabase
      .from("dashboard_holding_snapshot_dates")
      .select("trade_date")
      .order("trade_date", { ascending: false });
    if (listedDate) dateQuery = dateQuery.gte("trade_date", listedDate);
    const { data, error } = await dateQuery.range(from, from + dateChunkSize - 1);
    if (error) {
      errors.push(error.message);
      break;
    }

    const globalDates = ((data ?? []) as DateRecord[]).map((record) => record.trade_date);
    if (datePage === 0) globalLatestDate = globalDates[0] ?? null;
    if (globalDates.length === 0) break;

    const probe = await fetchPaged<Pick<SnapshotRecord, "trade_date" | "stock_id">>(
      (pageFrom, pageTo) =>
        supabase
          .from("holdings_snapshot")
          .select("trade_date, stock_id")
          .eq("etf_id", etfId)
          .in("trade_date", globalDates)
          .order("trade_date", { ascending: true })
          .order("stock_id", { ascending: true })
          .range(pageFrom, pageTo),
    );
    if (probe.error) errors.push(probe.error);
    const presentDates = new Set(probe.data.map((record) => record.trade_date));
    for (const date of globalDates) {
      if (presentDates.has(date)) found.add(date);
      if (found.size === timelineTradingDays) break;
    }

    if (globalDates.length < dateChunkSize) break;
    datePage += 1;
  }

  return {
    dates: Array.from(found).sort((left, right) => right.localeCompare(left)),
    globalLatestDate,
    error: errors.length > 0 ? errors.join("；") : null,
  };
}

async function fetchStockInfo(
  supabase: ReturnType<typeof createReadOnlySupabaseClient>,
  stockIds: string[],
): Promise<{ data: StockInfoRecord[]; error: string | null }> {
  if (stockIds.length === 0) return { data: [], error: null };
  const chunks = Array.from(
    { length: Math.ceil(stockIds.length / stockInfoChunkSize) },
    (_, index) => stockIds.slice(index * stockInfoChunkSize, (index + 1) * stockInfoChunkSize),
  );
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("stock_info")
        .select("stock_id, name, industry")
        .in("stock_id", chunk)
        .order("stock_id", { ascending: true }),
    ),
  );
  const errors = results.map((result) => result.error?.message).filter(Boolean);
  return {
    data: results.flatMap((result) => (result.data ?? []) as StockInfoRecord[]),
    error: errors.length > 0 ? errors.join("；") : null,
  };
}

function mapSnapshot(record: SnapshotRecord): SnapshotHolding {
  return {
    stockId: record.stock_id,
    shares: toNumber(record.shares) ?? 0,
    weightPct: toNumber(record.weight_pct) ?? 0,
  };
}

function buildWarnings({
  etf,
  latestDate,
  globalLatestDate,
  scrapeLogs,
  openPositions,
}: {
  etf: EtfRecord;
  latestDate: string | null;
  globalLatestDate: string | null;
  scrapeLogs: ScrapeLogRecord[];
  openPositions: OpenPositionRecord[];
}): DataGapWarning[] {
  const warnings: DataGapWarning[] = [];
  if (!latestDate) {
    warnings.push({
      title: "資料缺口",
      description: `${etf.etf_id} ${etf.name} 尚無持股快照。`,
    });
  } else if (globalLatestDate && latestDate < globalLatestDate) {
    warnings.push({
      title: "ETF 快照尚未更新",
      description: `${etf.etf_id} 最新快照為 ${latestDate}，全站最新交易日為 ${globalLatestDate}。`,
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
        .map((failure) => `${failure.tradeDate}：${failure.error ?? "未提供錯誤訊息"}`)
        .join("；"),
    });
  }

  const stalePositions = latestDate
    ? openPositions.filter((position) => position.as_of_date < latestDate)
    : [];
  if (stalePositions.length > 0) {
    warnings.push({
      title: "持有天數快取尚未更新",
      description: `${stalePositions.length} 筆 open_position 早於最新快照 ${latestDate}。`,
    });
  }
  return warnings;
}

export async function fetchEtfDetail(
  etfId: string,
  requestedStockId?: string,
): Promise<EtfDetailResult> {
  const supabase = createReadOnlySupabaseClient();
  const { data: etfData, error: etfError } = await supabase
    .from("etf")
    .select("etf_id, name, issuer, listed_date")
    .eq("etf_id", etfId)
    .limit(1);
  const etf = ((etfData ?? []) as EtfRecord[])[0];
  if (!etf) return { found: false, error: etfError?.message ?? null };

  const dateResult = await discoverEtfTradingDates(supabase, etfId, etf.listed_date);
  const latestDate = dateResult.dates[0] ?? null;
  const previousDate = dateResult.dates[1] ?? null;
  const twentyDayDate = dateResult.dates[20] ?? null;
  const comparisonDates = [latestDate, previousDate, twentyDayDate].filter(
    (date): date is string => date !== null,
  );
  const timelineStart = dateResult.dates[timelineTradingDays - 1]
    ?? dateResult.dates.at(-1)
    ?? latestDate;

  const snapshotResult = comparisonDates.length === 0
    ? { data: [] as SnapshotRecord[], error: null }
    : await fetchPaged<SnapshotRecord>((from, to) =>
        supabase
          .from("holdings_snapshot")
          .select("etf_id, trade_date, stock_id, shares, weight_pct")
          .eq("etf_id", etfId)
          .in("trade_date", comparisonDates)
          .order("trade_date", { ascending: true })
          .order("stock_id", { ascending: true })
          .range(from, to),
      );

  const [metricQuery, openPositionResult, changeResult, scrapeQuery] = await Promise.all([
    supabase
      .from("etf_metrics")
      .select(rankingMetricSelect)
      .eq("etf_id", etfId)
      .order("trade_date", { ascending: false })
      .limit(1),
    fetchPaged<OpenPositionRecord>((from, to) =>
      supabase
        .from("open_position")
        .select("etf_id, stock_id, entry_date, as_of_date, holding_days")
        .eq("etf_id", etfId)
        .order("stock_id", { ascending: true })
        .order("entry_date", { ascending: true })
        .range(from, to),
    ),
    timelineStart && latestDate
      ? fetchPaged<ChangeRecord>((from, to) =>
          supabase
            .from("holding_change")
            .select("etf_id, trade_date, stock_id, change_type, shares_delta, weight_delta_pct")
            .eq("etf_id", etfId)
            .gte("trade_date", timelineStart)
            .lte("trade_date", latestDate)
            .order("trade_date", { ascending: false })
            .order("stock_id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] as ChangeRecord[], error: null }),
    supabase
      .from("scrape_log")
      .select("etf_id, trade_date, run_at, status, error")
      .eq("etf_id", etfId)
      .order("run_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(scrapeLogLimit),
  ]);

  const currentRecords = snapshotResult.data.filter((record) => record.trade_date === latestDate);
  const timelineStockIds = changeResult.data.map((record) => record.stock_id);
  const stockIds = Array.from(new Set([
    ...currentRecords.map((record) => record.stock_id),
    ...timelineStockIds,
  ])).sort();
  const stockInfoResult = await fetchStockInfo(supabase, stockIds);
  const stockInfo = new Map<string, StockMetadata>(
    stockInfoResult.data.map((record) => [
      record.stock_id,
      { name: record.name || record.stock_id, industry: record.industry },
    ]),
  );
  const positions: OpenPositionValue[] = openPositionResult.data.map((record) => ({
    stockId: record.stock_id,
    entryDate: record.entry_date,
    holdingDays: record.holding_days,
    asOfDate: record.as_of_date,
  }));
  const holdings = buildHoldingRows({
    current: currentRecords.map(mapSnapshot),
    previous: previousDate
      ? snapshotResult.data.filter((record) => record.trade_date === previousDate).map(mapSnapshot)
      : null,
    twentyDaysAgo: twentyDayDate
      ? snapshotResult.data.filter((record) => record.trade_date === twentyDayDate).map(mapSnapshot)
      : null,
    stockInfo,
    openPositions: positions,
  });
  const selectedStockId = resolveSelectedStockId(holdings, requestedStockId);

  const [historyResult, exitResult] = selectedStockId
    ? await Promise.all([
        fetchPaged<SnapshotRecord>((from, to) =>
          supabase
            .from("holdings_snapshot")
            .select("etf_id, trade_date, stock_id, shares, weight_pct")
            .eq("etf_id", etfId)
            .eq("stock_id", selectedStockId)
            .order("trade_date", { ascending: true })
            .order("stock_id", { ascending: true })
            .range(from, to),
        ),
        fetchPaged<ChangeRecord>((from, to) =>
          supabase
            .from("holding_change")
            .select("etf_id, trade_date, stock_id, change_type, shares_delta, weight_delta_pct")
            .eq("etf_id", etfId)
            .eq("stock_id", selectedStockId)
            .eq("change_type", "EXIT")
            .order("trade_date", { ascending: true })
            .order("stock_id", { ascending: true })
            .range(from, to),
        ),
      ])
    : [
        { data: [] as SnapshotRecord[], error: null },
        { data: [] as ChangeRecord[], error: null },
      ];

  const changes: EtfChangeEvent[] = changeResult.data.map((record) => ({
    tradeDate: record.trade_date,
    stockId: record.stock_id,
    stockName: stockInfo.get(record.stock_id)?.name ?? record.stock_id,
    changeType: record.change_type,
    sharesDelta: toNumber(record.shares_delta) ?? 0,
    weightDeltaPct: toNumber(record.weight_delta_pct) ?? 0,
  }));
  const historyRecords: WeightHistoryRecord[] = historyResult.data.map((record) => ({
    tradeDate: record.trade_date,
    weightPct: toNumber(record.weight_pct) ?? 0,
  }));
  const metricRecord = ((metricQuery.data ?? []) as MetricRecord[])[0];
  const scrapeLogs = (scrapeQuery.data ?? []) as ScrapeLogRecord[];
  const errors = [
    etfError?.message,
    dateResult.error,
    snapshotResult.error,
    metricQuery.error?.message,
    openPositionResult.error,
    changeResult.error,
    scrapeQuery.error?.message,
    stockInfoResult.error,
    historyResult.error,
    exitResult.error,
  ].filter(Boolean);

  return {
    found: true,
    detail: {
      etfId: etf.etf_id,
      name: etf.name,
      issuer: etf.issuer,
      latestDate,
      previousDate,
      twentyDayDate,
      metric: metricRecord ? mapMetricRecord(metricRecord) : null,
      holdings,
      industries: aggregateIndustryWeights(holdings),
      changes,
      selectedStockId,
      selectedStockName: selectedStockId
        ? stockInfo.get(selectedStockId)?.name ?? selectedStockId
        : null,
      weightHistory: buildWeightHistory(
        historyRecords,
        exitResult.data.map((record) => record.trade_date),
      ),
      warnings: buildWarnings({
        etf,
        latestDate,
        globalLatestDate: dateResult.globalLatestDate,
        scrapeLogs,
        openPositions: openPositionResult.data,
      }),
      error: errors.length > 0 ? errors.join("；") : null,
    },
  };
}
