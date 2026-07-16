import { createReadOnlySupabaseClient } from "@/lib/supabase";
import type { IndustryDaily } from "@/lib/rotation";

type IndustryRecord = {
  trade_date: string;
  industry: string;
  sum_weight_pct: number | string;
  stock_count: number;
  etf_count_total: number;
};

export type RotationDataResult = {
  rows: IndustryDaily[];
  etfCountTotal: number; // etf table rows, 黃條分母
  error: string | null;
};

const pageSize = 1000;

export async function fetchRotationData(): Promise<RotationDataResult> {
  const supabase = createReadOnlySupabaseClient();
  const records: IndustryRecord[] = [];
  let page = 0;
  let pageError: string | null = null;
  while (true) {
    const from = page * pageSize;
    const { data, error } = await supabase
      .from("industry_weight_daily")
      .select("trade_date, industry, sum_weight_pct, stock_count, etf_count_total")
      .order("trade_date", { ascending: true })
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
  const { data: etfData, error: etfError } = await supabase.from("etf").select("etf_id");

  const rows: IndustryDaily[] = records.map((r) => ({
    tradeDate: r.trade_date,
    industry: r.industry,
    sumWeightPct: typeof r.sum_weight_pct === "number" ? r.sum_weight_pct : Number(r.sum_weight_pct),
    stockCount: r.stock_count,
    etfCountTotal: r.etf_count_total,
  }));
  const errors = [pageError, etfError?.message].filter(Boolean);
  return {
    rows,
    etfCountTotal: (etfData ?? []).length,
    error: errors.length > 0 ? errors.join("；") : null,
  };
}
