// Spec 2026-07-16 §7: all weights as %, max 2 decimals; changes signed (+12.33%);
// money in 億 TWD; shares shown as lots (1 lot = 1,000 shares).
export function formatPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

export function formatSignedPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatYi(valueTwd: number | null): string {
  return valueTwd === null ? "—" : `${(valueTwd / 1e8).toFixed(2)} 億`;
}

export function formatLots(shares: number): string {
  return Math.round(shares / 1000).toLocaleString("zh-TW");
}

// 海外持股代號採 Bloomberg 式「代號 交易所」後綴；stock_info 只有台股，
// 因此以空格加兩個大寫字母的結尾判別市場。
export function stockMarket(stockId: string): "tw" | "overseas" {
  return / [A-Z]{2}$/.test(stockId) ? "overseas" : "tw";
}

// 海外持股缺少 stock_info 名稱時，名稱會 fallback 成代號；此時只顯示一次。
export function formatStockLabel(
  stockId: string,
  stockName: string | null | undefined,
): string {
  return !stockName || stockName === stockId ? stockId : `${stockId} ${stockName}`;
}
