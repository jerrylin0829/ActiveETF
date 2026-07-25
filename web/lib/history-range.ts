import { createReadOnlySupabaseClient } from "@/lib/supabase";

export type HistoryRange = {
  etfId: string;
  historyFrom: string;
  historyTo: string;
};

type HistoryRangeRow = {
  etf_id: string;
  history_from: string;
  history_to: string;
};

export function formatHistoryFrom(
  ranges: HistoryRange[],
  etfId: string,
): string | null {
  const found = ranges.find((range) => range.etfId === etfId);
  return found ? `歷史資料自 ${found.historyFrom} 起` : null;
}

export async function fetchHistoryRanges(): Promise<{
  ranges: HistoryRange[];
  error: string | null;
}> {
  const supabase = createReadOnlySupabaseClient();
  const { data, error } = await supabase
    .from("dashboard_etf_history_range")
    .select("etf_id, history_from, history_to");

  if (error) {
    return { ranges: [], error: error.message };
  }

  return {
    ranges: ((data ?? []) as HistoryRangeRow[]).map((row) => ({
      etfId: row.etf_id,
      historyFrom: row.history_from,
      historyTo: row.history_to,
    })),
    error: null,
  };
}
