"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type KeyboardEvent } from "react";

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
import { formatLots, formatPct, formatSignedPct, formatStockLabel } from "@/lib/format";
import {
  sortHoldingRows,
  type EtfHoldingRow,
  type HoldingChangeValue,
  type HoldingSortField,
} from "@/lib/etf-detail";
import type { SortDirection } from "@/lib/rankings";
import { cn } from "@/lib/utils";

function SortButton({
  field,
  label,
  activeField,
  direction,
  onSort,
}: {
  field: HoldingSortField;
  label: string;
  activeField: HoldingSortField;
  direction: SortDirection;
  onSort: (field: HoldingSortField) => void;
}) {
  const active = field === activeField;
  const Icon = active ? (direction === "desc" ? ArrowDown : ArrowUp) : ChevronsUpDown;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`${label}排序`}
      className="h-8 px-2 text-xs font-semibold text-inherit"
      onClick={() => onSort(field)}
    >
      {label}
      <Icon className="ml-1 size-3.5" aria-hidden="true" />
    </Button>
  );
}

function ChangeCell({ value }: { value: HoldingChangeValue }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  if (value === "NEW") {
    return <span className="font-semibold text-[var(--market-up)]">NEW</span>;
  }
  return (
    <span className={value >= 0 ? "text-[var(--market-up)]" : "text-[var(--market-down)]"}>
      {formatSignedPct(value)}
    </span>
  );
}

export function HoldingsTable({
  etfId,
  rows,
  selectedStockId,
  previousDate,
  twentyDayDate,
}: {
  etfId: string;
  rows: EtfHoldingRow[];
  selectedStockId: string | null;
  previousDate: string | null;
  twentyDayDate: string | null;
}) {
  const router = useRouter();
  const [sortField, setSortField] = useState<HoldingSortField>("weightPct");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const sortedRows = useMemo(
    () => sortHoldingRows(rows, sortField, direction),
    [direction, rows, sortField],
  );

  function handleSort(field: HoldingSortField) {
    if (field === sortField) {
      setDirection((current) => current === "desc" ? "asc" : "desc");
      return;
    }
    setSortField(field);
    setDirection("desc");
  }

  function stockHref(stockId: string): string {
    return `/etf/${encodeURIComponent(etfId)}?stock=${encodeURIComponent(stockId)}#weight-history`;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>, stockId: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    router.push(stockHref(stockId));
  }

  return (
    <section aria-labelledby="holdings-title" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="holdings-title" className="text-xl font-semibold">當前持股</h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
            {rows.length} 檔
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>前日 {previousDate ?? "—"}</div>
          <div>20 日前 {twentyDayDate ?? "—"}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          尚無當前持股快照
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-md border border-border bg-card">
          <Table className="min-w-[940px]">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-56">代號 / 名稱</TableHead>
                <TableHead>產業</TableHead>
                <TableHead className="text-right">
                  <SortButton field="weightPct" label="權重" activeField={sortField} direction={direction} onSort={handleSort} />
                </TableHead>
                <TableHead className="text-right">
                  <SortButton field="previousChange" label="前日變化" activeField={sortField} direction={direction} onSort={handleSort} />
                </TableHead>
                <TableHead className="text-right">
                  <SortButton field="twentyDayChange" label="20 日變化" activeField={sortField} direction={direction} onSort={handleSort} />
                </TableHead>
                <TableHead className="text-right">
                  <SortButton field="shares" label="張數" activeField={sortField} direction={direction} onSort={handleSort} />
                </TableHead>
                <TableHead className="text-right">
                  <SortButton field="holdingDays" label="持有交易日" activeField={sortField} direction={direction} onSort={handleSort} />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((row) => {
                const selected = row.stockId === selectedStockId;
                return (
                  <TableRow
                    key={row.stockId}
                    data-testid="holding-row"
                    data-selected={selected || undefined}
                    role="link"
                    tabIndex={0}
                    aria-label={`查看 ${formatStockLabel(row.stockId, row.stockName)} 權重歷史`}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      selected && "bg-muted/60",
                    )}
                    onClick={() => router.push(stockHref(row.stockId))}
                    onKeyDown={(event) => handleKeyDown(event, row.stockId)}
                  >
                    <TableCell>
                      <div className="font-mono text-sm font-semibold tabular-nums">
                        {formatStockLabel(row.stockId, row.stockName)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.industry}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatPct(row.weightPct)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums"><ChangeCell value={row.previousChange} /></TableCell>
                    <TableCell className="text-right font-mono tabular-nums"><ChangeCell value={row.twentyDayChange} /></TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatLots(row.shares)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-mono tabular-nums">
                          {row.holdingDays === null ? "—" : `${row.holdingDays} 天`}
                        </span>
                        {row.isLongHeld ? (
                          <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-800">長抱</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
