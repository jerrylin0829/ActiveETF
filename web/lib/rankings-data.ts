import { createReadOnlySupabaseClient } from "@/lib/supabase";
import { pickLatestMetrics, type RankingRow } from "@/lib/rankings";

type MetricRecord = {
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

export type RankingsResult =
  | { rows: RankingRow[]; error: null }
  | { rows: RankingRow[]; error: string };

const metricSelect = `
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

export async function fetchRankingRows(): Promise<RankingsResult> {
  const supabase = createReadOnlySupabaseClient();
  const { data, error } = await supabase
    .from("etf_metrics")
    .select(metricSelect)
    .order("trade_date", { ascending: false })
    .limit(1000);

  if (error) {
    return { rows: [], error: error.message };
  }

  const rows = pickLatestMetrics(((data ?? []) as MetricRecord[]).map(mapMetricRecord));
  return { rows, error: null };
}
