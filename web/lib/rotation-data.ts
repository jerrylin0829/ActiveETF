import { createReadOnlySupabaseClient } from "@/lib/supabase";
import {
  normalizeRotationRange,
  rotationRangeStartDate,
  type IndustryDaily,
  type RotationRange,
} from "@/lib/rotation";

type IndustryRecord = {
  trade_date: string;
  industry: string;
  sum_weight_pct: number | string;
  stock_count: number;
  etf_count_total: number;
};

export type RotationDataResult = {
  rows: IndustryDaily[];
  range: RotationRange;
  etfCountTotal: number; // etf table rows, 黃條分母
  error: string | null;
};

const pageSize = 1000;

export async function fetchRotationData(rangeParam?: string): Promise<RotationDataResult> {
  const supabase = createReadOnlySupabaseClient();
  const range = normalizeRotationRange(rangeParam);
  const [dateResult, etfResult] = await Promise.all([
    supabase
      .from("dashboard_cross_dates")
      .select("trade_date")
      .order("trade_date", { ascending: false })
      .limit(21),
    supabase.from("etf").select("etf_id"),
  ]);
  const aggregateDates = (dateResult.data ?? []).map((row) => row.trade_date as string);
  const latestDate = aggregateDates[0];
  if (!latestDate) {
    const errors = [dateResult.error?.message, etfResult.error?.message].filter(Boolean);
    return {
      rows: [],
      range,
      etfCountTotal: (etfResult.data ?? []).length,
      error: errors.length > 0 ? errors.join("；") : null,
    };
  }
  const displayStartDate = rotationRangeStartDate(latestDate, range);
  const calculationStartDate = aggregateDates.at(-1);
  const startDate =
    displayStartDate && calculationStartDate
      ? [displayStartDate, calculationStartDate].sort()[0]
      : displayStartDate;
  const records: IndustryRecord[] = [];
  let page = 0;
  let pageError: string | null = null;
  while (true) {
    const from = page * pageSize;
    let query = supabase
      .from("industry_weight_daily")
      .select("trade_date, industry, sum_weight_pct, stock_count, etf_count_total");
    if (startDate) {
      query = query.gte("trade_date", startDate);
    }
    const { data, error } = await query
      .order("trade_date", { ascending: true })
      .order("industry", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      pageError = error.message;
      break;
    }
    const batch = (data ?? []) as IndustryRecord[];
    records.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
    page += 1;
  }
  const rows: IndustryDaily[] = records.map((r) => ({
    tradeDate: r.trade_date,
    industry: r.industry,
    sumWeightPct: typeof r.sum_weight_pct === "number" ? r.sum_weight_pct : Number(r.sum_weight_pct),
    stockCount: r.stock_count,
    etfCountTotal: r.etf_count_total,
  }));
  const errors = [dateResult.error?.message, pageError, etfResult.error?.message].filter(Boolean);
  return {
    rows,
    range,
    etfCountTotal: (etfResult.data ?? []).length,
    error: errors.length > 0 ? errors.join("；") : null,
  };
}
