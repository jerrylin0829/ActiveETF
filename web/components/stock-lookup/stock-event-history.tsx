import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatSignedPct } from "@/lib/format";
import type { StockChangeEvent, StockChangeType } from "@/lib/stock-lookup";
import { formatSharesDelta } from "@/lib/today-overview";
import { cn } from "@/lib/utils";

function badgeTone(changeType: StockChangeType): string {
  return changeType === "NEW" || changeType === "ADD"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function valueTone(changeType: StockChangeType): string {
  return changeType === "NEW" || changeType === "ADD"
    ? "text-[var(--market-up)]"
    : "text-[var(--market-down)]";
}

export function StockEventHistory({ events }: { events: StockChangeEvent[] }) {
  const groups = new Map<string, StockChangeEvent[]>();
  for (const event of events) {
    const group = groups.get(event.tradeDate) ?? [];
    group.push(event);
    groups.set(event.tradeDate, group);
  }
  const dates = Array.from(groups.keys()).sort((left, right) => right.localeCompare(left));

  return (
    <section aria-labelledby="stock-events-title" className="min-w-0 space-y-3">
      <div>
        <h2 id="stock-events-title" className="text-xl font-semibold">事件歷史</h2>
        <p className="mt-1 text-sm text-muted-foreground">最近 30 個交易日</p>
      </div>
      {events.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          最近 30 個交易日沒有異動事件
        </div>
      ) : (
        <ol className="divide-y divide-border border-y border-border">
          {dates.map((date) => (
            <li key={date} className="grid gap-3 py-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <h3 className="font-mono text-sm font-semibold tabular-nums">{date}</h3>
              <ul className="grid gap-3">
                {groups.get(date)!.map((event) => (
                  <li
                    key={`${event.etfId}-${event.changeType}`}
                    className="grid gap-2 sm:grid-cols-[4rem_minmax(0,1fr)_7rem_6rem] sm:items-center"
                  >
                    <Badge variant="outline" className={badgeTone(event.changeType)}>
                      {event.changeType}
                    </Badge>
                    <Link
                      href={`/etf/${encodeURIComponent(event.etfId)}`}
                      className="min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-mono text-sm font-semibold tabular-nums">{event.etfId}</span>
                      <span className="ml-2 text-sm hover:text-primary">{event.etfName}</span>
                    </Link>
                    <span className={cn("font-mono text-sm tabular-nums", valueTone(event.changeType))}>
                      {formatSharesDelta(event.sharesDelta)} 股
                    </span>
                    <span className={cn("font-mono text-sm tabular-nums", valueTone(event.changeType))}>
                      {formatSignedPct(event.weightDeltaPct)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
