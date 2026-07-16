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
