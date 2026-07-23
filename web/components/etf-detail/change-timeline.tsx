import { Badge } from "@/components/ui/badge";
import { formatSignedPct, formatStockLabel } from "@/lib/format";
import { formatSharesDelta } from "@/lib/today-overview";
import type { EtfChangeEvent, EtfChangeType } from "@/lib/etf-detail";
import { cn } from "@/lib/utils";

function badgeTone(changeType: EtfChangeType): string {
  return changeType === "NEW" || changeType === "ADD"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function valueTone(changeType: EtfChangeType): string {
  return changeType === "NEW" || changeType === "ADD"
    ? "text-[var(--market-up)]"
    : "text-[var(--market-down)]";
}

export function ChangeTimeline({ events }: { events: EtfChangeEvent[] }) {
  const groups = new Map<string, EtfChangeEvent[]>();
  for (const event of events) {
    const group = groups.get(event.tradeDate) ?? [];
    group.push(event);
    groups.set(event.tradeDate, group);
  }
  const dates = Array.from(groups.keys()).sort((left, right) => right.localeCompare(left));

  return (
    <section aria-labelledby="change-timeline-title" className="min-w-0 space-y-3">
      <div>
        <h2 id="change-timeline-title" className="text-xl font-semibold">異動時間軸</h2>
        <p className="mt-1 text-xs text-muted-foreground">最近 30 個交易日</p>
      </div>
      {events.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          此期間沒有異動事件
        </div>
      ) : (
        <ol className="divide-y divide-border border-y border-border">
          {dates.map((date) => (
            <li key={date} className="grid gap-3 py-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <h3 className="font-mono text-sm font-semibold tabular-nums">{date}</h3>
              <ul className="grid gap-3">
                {groups.get(date)!.map((event) => (
                  <li
                    key={`${event.stockId}-${event.changeType}`}
                    className="grid gap-2 sm:grid-cols-[4rem_minmax(0,1fr)_7rem_6rem] sm:items-center"
                  >
                    <Badge variant="outline" className={badgeTone(event.changeType)}>
                      {event.changeType}
                    </Badge>
                    <div className="min-w-0">
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        {formatStockLabel(event.stockId, event.stockName)}
                      </span>
                    </div>
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
