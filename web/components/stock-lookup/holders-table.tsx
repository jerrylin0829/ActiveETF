import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatLots, formatPct } from "@/lib/format";
import type { StockChangeType, StockHolderRow } from "@/lib/stock-lookup";

function badgeTone(changeType: StockChangeType): string {
  return changeType === "NEW" || changeType === "ADD"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export function HoldersTable({
  rows,
  latestDate,
}: {
  rows: StockHolderRow[];
  latestDate: string | null;
}) {
  return (
    <section aria-labelledby="stock-holders-title" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="stock-holders-title" className="text-xl font-semibold">誰持有</h2>
          <p className="mt-1 text-sm text-muted-foreground">最新交易日的主動 ETF 持股</p>
        </div>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {latestDate ?? "—"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          最新交易日沒有主動 ETF 持有此股票
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-md border border-border bg-card">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>ETF</TableHead>
                <TableHead className="text-right">權重</TableHead>
                <TableHead className="text-right">張數</TableHead>
                <TableHead>當日異動</TableHead>
                <TableHead className="text-right">持有交易日</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.etfId} data-testid="stock-holder-row">
                  <TableCell>
                    <Link
                      href={`/etf/${encodeURIComponent(row.etfId)}`}
                      className="inline-flex flex-wrap items-baseline gap-x-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-mono text-sm font-semibold tabular-nums">{row.etfId}</span>
                      <span className="text-sm hover:text-primary">{row.etfName}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPct(row.weightPct)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatLots(row.shares)}
                  </TableCell>
                  <TableCell>
                    {row.changeType ? (
                      <Badge variant="outline" className={badgeTone(row.changeType)}>
                        {row.changeType}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="font-mono tabular-nums">
                        {row.holdingDays === null ? "—" : `${row.holdingDays} 天`}
                      </span>
                      {row.isLongHeld ? (
                        <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-800">
                          長抱
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
