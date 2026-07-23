import { createReadOnlySupabaseClient } from "@/lib/supabase";
import {
  buildDataGapWarnings,
  latestUnresolvedScrapeFailures,
  pickLatestMetrics,
  type DataGapWarning,
  type RankingRow,
  type ScrapeLogEntry,
} from "@/lib/rankings";

export type MetricRecord = {
  etf_id: string;
  trade_date: string;
  ret_1m: number | string | null;
  ret_3m: number | string | null;
  ret_6m: number | string | null;
  ret_1y: number | string | null;
  ret_inception: number | string | null;
  bench_0050_1m: number | string | null;
  bench_0050_3m: number | string | null;
  bench_0050_6m: number | string | null;
  bench_0050_1y: number | string | null;
  bench_0050_inception: number | string | null;
  timing_wins: number | null;
  timing_months: number | null;
  picking_realized_wins: number | null;
  picking_realized_total: number | null;
  picking_open_wins: number | null;
  picking_open_total: number | null;
  median_holding_days: number | string | null;
  weekly_turnover_pct: number | string | null;
  etf: { name: string; issuer: string } | { name: string; issuer: string }[] | null;
};

type EtfRecord = {
  etf_id: string;
  name: string;
  issuer: string;
};

type ScrapeLogRecord = {
  etf_id: string;
  trade_date: string;
  run_at: string;
  status: "ok" | "fail";
  error: string | null;
};

export type RankingsResult = {
  rows: RankingRow[];
  warnings: DataGapWarning[];
  error: string | null;
};

export const rankingMetricSelect = `
  etf_id,
  trade_date,
  ret_1m,
  ret_3m,
  ret_6m,
  ret_1y,
  ret_inception,
  bench_0050_1m,
  bench_0050_3m,
  bench_0050_6m,
  bench_0050_1y,
  bench_0050_inception,
  timing_wins,
  timing_months,
  picking_realized_wins,
  picking_realized_total,
  picking_open_wins,
  picking_open_total,
  median_holding_days,
  weekly_turnover_pct,
  etf(name, issuer)
`;

const pageSize = 1000;
const scrapeLogLookbackLimit = 250;

function toNumber(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function relatedEtf(value: MetricRecord["etf"]): { name: string; issuer: string } | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

export function mapMetricRecord(record: MetricRecord): RankingRow {
  const etf = relatedEtf(record.etf);

  return {
    etfId: record.etf_id,
    name: etf?.name ?? "未命名 ETF",
    issuer: etf?.issuer ?? "未提供",
    tradeDate: record.trade_date,
    ret1m: toNumber(record.ret_1m),
    ret3m: toNumber(record.ret_3m),
    ret6m: toNumber(record.ret_6m),
    ret1y: toNumber(record.ret_1y),
    retInception: toNumber(record.ret_inception),
    bench00501m: toNumber(record.bench_0050_1m),
    bench00503m: toNumber(record.bench_0050_3m),
    bench00506m: toNumber(record.bench_0050_6m),
    bench00501y: toNumber(record.bench_0050_1y),
    bench0050Inception: toNumber(record.bench_0050_inception),
    timingWins: record.timing_wins ?? 0,
    timingMonths: record.timing_months ?? 0,
    pickingRealizedWins: record.picking_realized_wins ?? 0,
    pickingRealizedTotal: record.picking_realized_total ?? 0,
    pickingOpenWins: record.picking_open_wins ?? 0,
    pickingOpenTotal: record.picking_open_total ?? 0,
    medianHoldingDays: toNumber(record.median_holding_days),
    weeklyTurnoverPct: toNumber(record.weekly_turnover_pct),
  };
}

async function fetchAllMetricRecords(
  supabase: ReturnType<typeof createReadOnlySupabaseClient>,
): Promise<{ data: MetricRecord[]; error: string | null }> {
  const records: MetricRecord[] = [];
  let page = 0;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("etf_metrics")
      .select(rankingMetricSelect)
      .order("trade_date", { ascending: false })
      .range(from, to);

    if (error) {
      return { data: records, error: error.message };
    }

    const pageRecords = (data ?? []) as MetricRecord[];
    records.push(...pageRecords);

    if (pageRecords.length < pageSize) {
      return { data: records, error: null };
    }

    page += 1;
  }
}

export async function fetchRankingRows(): Promise<RankingsResult> {
  const supabase = createReadOnlySupabaseClient();
  const [
    { data: etfData, error: etfError },
    { data: scrapeLogData, error: scrapeLogError },
    metricsResult,
  ] = await Promise.all([
    supabase.from("etf").select("etf_id, name, issuer").order("etf_id", { ascending: true }),
    supabase
      .from("scrape_log")
      .select("etf_id, trade_date, run_at, status, error")
      .order("run_at", { ascending: false })
      .limit(scrapeLogLookbackLimit),
    fetchAllMetricRecords(supabase),
  ]);

  const rows = pickLatestMetrics(metricsResult.data.map(mapMetricRecord));
  const etfs = ((etfData ?? []) as EtfRecord[]).map((etf) => ({
    etfId: etf.etf_id,
    name: etf.name,
  }));
  const scrapeLogs = ((scrapeLogData ?? []) as ScrapeLogRecord[]).map((log) => ({
    etfId: log.etf_id,
    tradeDate: log.trade_date,
    runAt: log.run_at,
    status: log.status,
    error: log.error,
  }));
  const scrapeFailures = latestUnresolvedScrapeFailures(scrapeLogs as ScrapeLogEntry[]);
  const warnings = buildDataGapWarnings({ etfs, rows, scrapeFailures });
  const errors = [etfError?.message, scrapeLogError?.message, metricsResult.error].filter(Boolean);

  if (errors.length > 0) {
    return { rows, warnings, error: errors.join("；") };
  }

  return { rows, warnings, error: null };
}
