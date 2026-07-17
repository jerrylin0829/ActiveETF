"use client";

import { Fragment, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  applyFilters,
  sortRows,
  type CoverageFilter,
  type CrossDetail,
  type CrossRow,
  type SortKey,
  type SortState,
} from "@/lib/cross-holdings";
import { formatLots, formatPct, formatYi } from "@/lib/format";

type CrossHoldingsTableProps = {
  rows: CrossRow[];
  details: Record<string, CrossDetail[]>;
};

const coverageOptions: { value: CoverageFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "min2", label: "≥2 檔" },
  { value: "min3", label: "≥3 檔" },
  { value: "min5", label: "≥5 檔" },
  { value: "only1", label: "獨門(=1)" },
];

const changeLabel: Record<string, string> = {
  NEW: "新進",
  ADD: "加碼",
  TRIM: "減碼",
  EXIT: "出清",
};

// mirrors badgeTone() in today-overview-dashboard.tsx: 紅漲綠跌
const UP_BADGE = "border-red-200 bg-red-50 text-red-700";
const DOWN_BADGE = "border-emerald-200 bg-emerald-50 text-emerald-700";

export function CrossHoldingsTable({ rows, details }: CrossHoldingsTableProps) {
  const [sort, setSort] = useState<SortState>({ key: "etfCount", desc: true });
  const [coverage, setCoverage] = useState<CoverageFilter>("all");
  const [industry, setIndustry] = useState<string>("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const industries = useMemo(() => [...new Set(rows.map((r) => r.industry))].sort(), [rows]);
  const visible = useMemo(() => {
    const filtered = applyFilters(rows, {
      coverage,
      industries: industry ? [industry] : [],
      changedOnly,
    });
    return sortRows(filtered, sort);
  }, [rows, coverage, industry, changedOnly, sort]);

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        該日無資料，請改選其他交易日。
      </p>
    );
  }

  const sortableHead = (key: SortKey, label: string) => (
    <TableHead className="whitespace-nowrap">
      <button
        type="button"
        className="font-medium hover:text-foreground"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
      >
        {label}
        {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </TableHead>
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1 font-medium text-muted-foreground">
          涵蓋檔數
          <select
            value={coverage}
            onChange={(e) => setCoverage(e.target.value as CoverageFilter)}
            className="h-9 rounded-md border border-input bg-card px-2 text-foreground"
          >
            {coverageOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 font-medium text-muted-foreground">
          產業
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="h-9 rounded-md border border-input bg-card px-2 text-foreground"
          >
            <option value="">全部產業</option>
            {industries.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-9 items-center gap-2 font-medium text-muted-foreground">
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(e) => setChangedOnly(e.target.checked)}
          />
          只看當日有異動
        </label>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>代號 / 名稱</TableHead>
              <TableHead className="hidden md:table-cell">產業</TableHead>
              {sortableHead("etfCount", "涵蓋檔數")}
              {sortableHead("totalWeightPct", "合計權重")}
              {sortableHead("totalValueTwd", "合計金額")}
              {sortableHead("totalShares", "合計張數")}
              <TableHead>當日異動</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <Fragment key={r.stockId}>
                <TableRow
                  data-testid="cross-row"
                  className="cursor-pointer"
                  onClick={() => setExpanded(expanded === r.stockId ? null : r.stockId)}
                >
                  <TableCell className="font-mono">
                    {r.stockId} {r.stockName}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{r.industry}</TableCell>
                  <TableCell className="tabular-nums">{r.etfCount}</TableCell>
                  <TableCell className="tabular-nums">{formatPct(r.totalWeightPct)}</TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">
                    {formatYi(r.totalValueTwd)}
                  </TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">
                    {formatLots(r.totalShares)}
                  </TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap">
                    {r.newCount > 0 && <Badge className={UP_BADGE}>新進×{r.newCount}</Badge>}
                    {r.addCount > 0 && <Badge className={UP_BADGE}>加碼×{r.addCount}</Badge>}
                    {r.trimCount > 0 && <Badge className={DOWN_BADGE}>減碼×{r.trimCount}</Badge>}
                    {r.exitCount > 0 && <Badge className={DOWN_BADGE}>出清×{r.exitCount}</Badge>}
                  </TableCell>
                </TableRow>
                {expanded === r.stockId &&
                  (details[r.stockId] ?? []).map((d) => (
                    <TableRow key={`${r.stockId}-${d.etfId}`} className="bg-muted/40">
                      <TableCell colSpan={2} className="pl-8 font-mono text-sm">
                        {d.etfId} {d.etfName}
                      </TableCell>
                      <TableCell />
                      <TableCell className="tabular-nums">{formatPct(d.weightPct)}</TableCell>
                      <TableCell className="hidden sm:table-cell" />
                      <TableCell className="hidden tabular-nums sm:table-cell">
                        {formatLots(d.shares)}
                      </TableCell>
                      <TableCell>{d.changeType ? changeLabel[d.changeType] : ""}</TableCell>
                    </TableRow>
                  ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
