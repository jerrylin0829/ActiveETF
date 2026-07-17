export type CrossRow = {
  stockId: string;
  stockName: string;
  industry: string;
  etfCount: number;
  totalWeightPct: number;
  totalShares: number;
  totalValueTwd: number | null;
  newCount: number;
  addCount: number;
  trimCount: number;
  exitCount: number;
};

export type CrossDetail = {
  etfId: string;
  etfName: string;
  weightPct: number;
  shares: number;
  changeType: "NEW" | "ADD" | "TRIM" | "EXIT" | null;
};

export type SortKey = "etfCount" | "totalWeightPct" | "totalShares" | "totalValueTwd";
export type SortState = { key: SortKey; desc: boolean };
export type CoverageFilter = "all" | "min2" | "min3" | "min5" | "only1";
export type CrossFilters = {
  coverage: CoverageFilter;
  industries: string[];
  changedOnly: boolean;
};

const coveragePredicate: Record<CoverageFilter, (n: number) => boolean> = {
  all: () => true,
  min2: (n) => n >= 2,
  min3: (n) => n >= 3,
  min5: (n) => n >= 5,
  only1: (n) => n === 1,
};

export function applyFilters(rows: CrossRow[], filters: CrossFilters): CrossRow[] {
  return rows.filter((r) => {
    if (!coveragePredicate[filters.coverage](r.etfCount)) return false;
    if (filters.industries.length > 0 && !filters.industries.includes(r.industry)) return false;
    if (filters.changedOnly && r.newCount + r.addCount + r.trimCount + r.exitCount === 0)
      return false;
    return true;
  });
}

export function sortRows(rows: CrossRow[], sort: SortState): CrossRow[] {
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[sort.key] ?? -Infinity;
    const bv = b[sort.key] ?? -Infinity;
    if (av !== bv) return av < bv ? -dir : dir;
    // secondary key: total weight desc, then stock id for stability
    if (a.totalWeightPct !== b.totalWeightPct) return b.totalWeightPct - a.totalWeightPct;
    return a.stockId.localeCompare(b.stockId);
  });
}
