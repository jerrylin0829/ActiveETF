import { createReadOnlySupabaseClient } from "@/lib/supabase";
import type { CrossDetail, CrossRow } from "@/lib/cross-holdings";

type CrossRecord = {
  trade_date: string;
  stock_id: string;
  etf_count: number;
  total_weight_pct: number | string;
  total_shares: number | string;
  total_value_twd: number | string | null;
  new_count: number;
  add_count: number;
  trim_count: number;
  exit_count: number;
};

type HoldingRecord = {
  etf_id: string;
  stock_id: string;
  shares: number | string;
  weight_pct: number | string;
  etf: { name: string } | { name: string }[] | null;
};

type ChangeRecord = {
  etf_id: string;
  stock_id: string;
  change_type: string;
};

type StockInfoRecord = {
  stock_id: string;
  name: string;
  industry: string | null;
};

export type CrossHoldingsResult = {
  date: string | null; // resolved trade date (latest if not given)
  availableDates: string[]; // for the date selector, desc
  rows: CrossRow[];
  details: Record<string, CrossDetail[]>; // stockId -> per-ETF breakdown
  etfCountThatDay: number; // distinct ETFs with snapshot that day
  etfCountTotal: number; // rows in etf table (黃條分母)
  error: string | null;
};

const pageSize = 1000;
const stockInfoChunkSize = 200;

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function relatedEtf(value: HoldingRecord["etf"]): { name: string } | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value;
}

async function fetchAllByDate<T>(
  supabase: ReturnType<typeof createReadOnlySupabaseClient>,
  table: string,
  select: string,
  date: string,
  orderColumns: string[],
): Promise<{ data: T[]; error: string | null }> {
  const records: T[] = [];
  let page = 0;
  while (true) {
    const from = page * pageSize;
    let query = supabase
      .from(table)
      .select(select)
      .eq("trade_date", date);
    for (const column of orderColumns) {
      query = query.order(column, { ascending: true });
    }
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) {
      return { data: records, error: error.message };
    }
    const batch = (data ?? []) as T[];
    records.push(...batch);
    if (batch.length < pageSize) {
      return { data: records, error: null };
    }
    page += 1;
  }
}

async function fetchStockInfo(
  supabase: ReturnType<typeof createReadOnlySupabaseClient>,
  stockIds: string[],
): Promise<{ data: StockInfoRecord[]; error: string | null }> {
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

export async function fetchCrossHoldings(dateParam?: string): Promise<CrossHoldingsResult> {
  const supabase = createReadOnlySupabaseClient();
  const empty: CrossHoldingsResult = {
    date: null,
    availableDates: [],
    rows: [],
    details: {},
    etfCountThatDay: 0,
    etfCountTotal: 0,
    error: null,
  };

  const { data: dateData, error: dateError } = await supabase
    .from("dashboard_cross_dates")
    .select("trade_date")
    .order("trade_date", { ascending: false })
    .limit(120);
  if (dateError) {
    return { ...empty, error: dateError.message };
  }

  const availableDates = (dateData ?? []).map((r) => r.trade_date as string);
  const date = dateParam && availableDates.includes(dateParam) ? dateParam : availableDates[0];
  if (!date) {
    return { ...empty, availableDates };
  }

  const [crossRes, holdingRes, changeRes, etfRes] = await Promise.all([
    fetchAllByDate<CrossRecord>(supabase, "cross_holdings_daily", "*", date, ["stock_id"]),
    fetchAllByDate<HoldingRecord>(
      supabase,
      "holdings_snapshot",
      "etf_id, stock_id, shares, weight_pct, etf(name)",
      date,
      ["etf_id", "stock_id"],
    ),
    fetchAllByDate<ChangeRecord>(
      supabase,
      "holding_change",
      "etf_id, stock_id, change_type",
      date,
      ["etf_id", "stock_id"],
    ),
    supabase.from("etf").select("etf_id"),
  ]);
  const stockRes = await fetchStockInfo(
    supabase,
    Array.from(new Set(crossRes.data.map((record) => record.stock_id))),
  );

  const stockInfo = new Map(
    stockRes.data.map((s) => [
      s.stock_id as string,
      { name: (s.name as string) || s.stock_id, industry: (s.industry as string) || "未分類" },
    ]),
  );
  const changeMap = new Map(
    (changeRes.data ?? []).map((c) => [`${c.etf_id}:${c.stock_id}`, c.change_type]),
  );

  const rows: CrossRow[] = (crossRes.data ?? []).map((r) => ({
    stockId: r.stock_id,
    stockName: stockInfo.get(r.stock_id)?.name ?? r.stock_id,
    industry: stockInfo.get(r.stock_id)?.industry ?? "未分類",
    etfCount: r.etf_count,
    totalWeightPct: toNumber(r.total_weight_pct) ?? 0,
    totalShares: toNumber(r.total_shares) ?? 0,
    totalValueTwd: toNumber(r.total_value_twd),
    newCount: r.new_count,
    addCount: r.add_count,
    trimCount: r.trim_count,
    exitCount: r.exit_count,
  }));

  const details: Record<string, CrossDetail[]> = {};
  const etfIdsThatDay = new Set<string>();
  for (const h of holdingRes.data ?? []) {
    etfIdsThatDay.add(h.etf_id);
    const rel = relatedEtf(h.etf);
    (details[h.stock_id] ??= []).push({
      etfId: h.etf_id,
      etfName: rel?.name ?? h.etf_id,
      weightPct: toNumber(h.weight_pct) ?? 0,
      shares: toNumber(h.shares) ?? 0,
      changeType: (changeMap.get(`${h.etf_id}:${h.stock_id}`) ?? null) as CrossDetail["changeType"],
    });
  }
  for (const list of Object.values(details)) {
    list.sort((a, b) => b.weightPct - a.weightPct);
  }

  const errors = [
    crossRes.error,
    holdingRes.error,
    changeRes.error,
    etfRes.error?.message,
    stockRes.error,
  ].filter(Boolean);

  return {
    date,
    availableDates,
    rows,
    details,
    etfCountThatDay: etfIdsThatDay.size,
    etfCountTotal: (etfRes.data ?? []).length,
    error: errors.length > 0 ? errors.join("；") : null,
  };
}
