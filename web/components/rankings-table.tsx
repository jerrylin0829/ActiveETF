"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { DataGapAlerts } from "@/components/data-gap-alerts";
import { PickingDisclosure } from "@/components/picking-disclosure";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildPickingSummary,
  formatNumber,
  formatReturn,
  formatTurnover,
  formatWinRate,
  getReturnTone,
  sortRankings,
  winRateValue,
  type RankingRow,
  type DataGapWarning,
  type ReturnField,
  type SortDirection,
  type SortField,
} from "@/lib/rankings";
import { cn } from "@/lib/utils";

type RankingsTableProps = {
  rows: RankingRow[];
  warnings?: DataGapWarning[];
  error?: string | null;
};

type ReturnColumn = {
  field: ReturnField;
  benchmark: keyof RankingRow | null;
  label: string;
  aria: string;
};

const returnColumns: ReturnColumn[] = [
  { field: "ret1m", benchmark: "bench00501m", label: "1個月", aria: "1個月報酬排序" },
  { field: "ret3m", benchmark: "bench00503m", label: "3個月", aria: "3個月報酬排序" },
  { field: "ret6m", benchmark: "bench00506m", label: "6個月", aria: "6個月報酬排序" },
  { field: "ret1y", benchmark: "bench00501y", label: "1年", aria: "1年報酬排序" },
  {
    field: "retInception",
    benchmark: "bench0050Inception",
    label: "上市以來",
    aria: "上市以來報酬排序",
  },
];

function SortButton({
  field,
  label,
  aria,
  activeField,
  direction,
  onSort,
}: {
  field: SortField;
  label: string;
  aria: string;
  activeField: SortField;
  direction: SortDirection;
  onSort: (field: SortField) => void;
}) {
  const active = activeField === field;
  const Icon = active ? (direction === "desc" ? ArrowDown : ArrowUp) : ChevronsUpDown;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={aria}
      className="h-8 px-2 text-xs font-semibold text-inherit"
      onClick={() => onSort(field)}
    >
      {label}
      <Icon className="ml-1 size-3.5" aria-hidden="true" />
    </Button>
  );
}

function returnToneClass(tone: ReturnType<typeof getReturnTone>) {
  if (tone === "beat-positive") {
    return "text-[var(--market-up)]";
  }
  if (tone === "beat-negative") {
    return "text-[var(--market-down)]";
  }

  return "text-foreground";
}

function rateToneClass(value: number | null) {
  return value !== null && value >= 0.5 ? "text-[var(--market-up)]" : "text-foreground";
}

function ReturnCell({ row, column }: { row: RankingRow; column: ReturnColumn }) {
  const tone = getReturnTone(row, column.field);
  const benchmarkValue = column.benchmark ? row[column.benchmark] : null;

  return (
    <TableCell
      data-testid={`ranking-${row.etfId}-${column.field}`}
      className="min-w-28 text-right align-top"
    >
      <div className={cn("font-mono text-sm font-semibold tabular-nums", returnToneClass(tone))}>
        {formatReturn(row[column.field])}
      </div>
      {column.benchmark ? (
        <div className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
          0050 {formatReturn(benchmarkValue as number | null)}
        </div>
      ) : (
        <div className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">—</div>
      )}
    </TableCell>
  );
}

function PickingCell({
  wins,
  total,
}: {
  wins: number;
  total: number;
}) {
  const summary = buildPickingSummary(wins, total);
  const rate = winRateValue(wins, total);

  return (
    <div className={cn("space-y-1", summary.insufficient && "text-muted-foreground")}>
      <div className={cn("font-mono text-sm font-semibold tabular-nums", rateToneClass(rate))}>
        {summary.label}
      </div>
      {summary.insufficient ? (
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
          樣本不足
        </Badge>
      ) : null}
    </div>
  );
}

export function RankingsTable({ rows, warnings = [], error = null }: RankingsTableProps) {
  const [sortField, setSortField] = useState<SortField>("ret1m");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedRows = useMemo(
    () => sortRankings(rows, sortField, sortDirection),
    [rows, sortDirection, sortField],
  );

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }

    setSortField(field);
    setSortDirection("desc");
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        <Alert role="alert" className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertTitle>資料缺口</AlertTitle>
          <AlertDescription>
            目前尚無 ETF 指標快取資料。每日 pipeline 產生 `etf_metrics` 後，排行榜會自動顯示最新列。
            {error ? <span className="mt-2 block">Supabase 讀取訊息：{error}</span> : null}
          </AlertDescription>
        </Alert>
        <DataGapAlerts warnings={warnings} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DataGapAlerts warnings={warnings} />
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <Table className="min-w-[1180px]">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="sticky left-0 z-10 w-56 bg-muted/95">ETF</TableHead>
              <TableHead className="w-28">投信</TableHead>
              {returnColumns.map((column) => (
                <TableHead key={column.field} className="text-right">
                  <SortButton
                    field={column.field}
                    label={column.label}
                    aria={column.aria}
                    activeField={sortField}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                </TableHead>
              ))}
              <TableHead className="text-right">
                <SortButton
                  field="timingRate"
                  label="擇時勝率"
                  aria="擇時勝率排序"
                  activeField={sortField}
                  direction={sortDirection}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortButton
                  field="pickingRealizedRate"
                  label="選股已實現"
                  aria="選股已實現勝率排序"
                  activeField={sortField}
                  direction={sortDirection}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortButton
                  field="pickingOpenRate"
                  label="選股未平倉"
                  aria="選股未平倉勝率排序"
                  activeField={sortField}
                  direction={sortDirection}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortButton
                  field="medianHoldingDays"
                  label="持有中位數"
                  aria="持有中位數排序"
                  activeField={sortField}
                  direction={sortDirection}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortButton
                  field="weeklyTurnoverPct"
                  label="週換手率"
                  aria="週換手率排序"
                  activeField={sortField}
                  direction={sortDirection}
                  onSort={handleSort}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => {
              const timingRate = winRateValue(row.timingWins, row.timingMonths);

              return (
                <TableRow key={row.etfId}>
                  <TableCell className="sticky left-0 z-10 bg-card align-top">
                    <Link
                      href={`/etf/${encodeURIComponent(row.etfId)}`}
                      className="block rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="font-mono text-sm font-semibold tabular-nums">{row.etfId}</div>
                      <div className="mt-1 max-w-48 whitespace-normal text-sm font-medium">
                        {row.name}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{row.tradeDate}</div>
                    </Link>
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {row.issuer}
                  </TableCell>
                  {returnColumns.map((column) => (
                    <ReturnCell key={column.field} row={row} column={column} />
                  ))}
                  <TableCell className="text-right align-top">
                    <div
                      className={cn("font-mono text-sm font-semibold", rateToneClass(timingRate))}
                    >
                      {formatWinRate(row.timingWins, row.timingMonths)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right align-top">
                    <PickingCell
                      wins={row.pickingRealizedWins}
                      total={row.pickingRealizedTotal}
                    />
                  </TableCell>
                  <TableCell className="text-right align-top">
                    <PickingCell wins={row.pickingOpenWins} total={row.pickingOpenTotal} />
                  </TableCell>
                  <TableCell className="text-right align-top font-mono text-sm tabular-nums">
                    {formatNumber(row.medianHoldingDays, " 天")}
                  </TableCell>
                  <TableCell className="text-right align-top font-mono text-sm tabular-nums">
                    {formatTurnover(row.weeklyTurnoverPct)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <PickingDisclosure />
      </div>
    </div>
  );
}
