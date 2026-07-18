import Link from "next/link";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Radar } from "lucide-react";

import { DataGapAlerts } from "@/components/data-gap-alerts";
import { DateSelector } from "@/components/date-selector";
import { formatSignedPct } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { SiteNav } from "@/components/site-nav";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  formatSharesDelta,
  formatWeightDelta,
  type ChangeEvent,
  type CollectiveMove,
  type TodayOverviewViewModel,
} from "@/lib/today-overview";
import { cn } from "@/lib/utils";

const changeLabels: Record<ChangeEvent["changeType"], string> = {
  NEW: "NEW",
  EXIT: "EXIT",
  ADD: "ADD",
  TRIM: "TRIM",
};

function changeTone(changeType: ChangeEvent["changeType"]) {
  return changeType === "NEW" || changeType === "ADD"
    ? "text-[var(--market-up)]"
    : "text-[var(--market-down)]";
}

function badgeTone(changeType: ChangeEvent["changeType"]) {
  return changeType === "NEW" || changeType === "ADD"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function ChangeWall({ events }: { events: ChangeEvent[] }) {
  return (
    <section aria-labelledby="change-wall-title" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="change-wall-title" className="text-xl font-semibold">
            異動牆
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">NEW / EXIT 置頂，其次 ADD / TRIM。</p>
        </div>
        <Badge variant="outline">{events.length} 筆</Badge>
      </div>

      {events.length === 0 ? (
        <EmptyState>選定日期沒有異動事件。</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="divide-y divide-border">
            {events.map((event) => (
              <article
                key={`${event.etfId}-${event.stockId}-${event.changeType}`}
                className="grid gap-3 px-4 py-3 sm:grid-cols-[6rem_minmax(0,1fr)_8rem_8rem] sm:items-center"
              >
                <div>
                  <Badge variant="outline" className={badgeTone(event.changeType)}>
                    {changeLabels[event.changeType]}
                  </Badge>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {event.stockId}
                    </span>
                    <span className="font-medium">{event.stockName}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    <Link
                      href={`/etf/${encodeURIComponent(event.etfId)}`}
                      className="rounded-sm font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {event.etfId} {event.etfName}
                    </Link>
                  </div>
                </div>
                <div className={cn("font-mono text-sm font-semibold tabular-nums", changeTone(event.changeType))}>
                  {formatSharesDelta(event.sharesDelta)}
                </div>
                <div className={cn("font-mono text-sm font-semibold tabular-nums", changeTone(event.changeType))}>
                  {formatWeightDelta(event.weightDeltaPct)}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function CollectiveList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "up" | "down";
  items: CollectiveMove[];
}) {
  const Icon = tone === "up" ? ArrowUpRight : ArrowDownRight;
  const toneClass = tone === "up" ? "text-[var(--market-up)]" : "text-[var(--market-down)]";

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Icon className={cn("size-4", toneClass)} aria-hidden="true" />
        <h3 className="font-semibold">{title}</h3>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">此區間沒有資料。</div>
      ) : (
        <ol className="divide-y divide-border">
          {items.map((item, index) => (
            <li
              key={item.stockId}
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
            >
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {item.stockId}
                  </span>
                  <span className="font-medium">{item.stockName}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{item.etfCount} 檔 ETF</div>
              </div>
              <span className={cn("font-mono text-sm font-semibold tabular-nums", toneClass)}>
                {formatWeightDelta(item.totalWeightDeltaPct)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function CollectiveMovements({ overview }: { overview: TodayOverviewViewModel }) {
  return (
    <section aria-label="集體動向" className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">集體動向</h2>
          <p className="mt-1 text-sm text-muted-foreground">依 ETF 檔數排序，再比合計權重變化。</p>
        </div>
        <div className="flex gap-2">
          {overview.rangeOptions.map((option) => (
            <Link
              key={option.value}
              href={option.href}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                option.active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CollectiveList title="最多 ETF 加碼" tone="up" items={overview.collective.increases} />
        <CollectiveList title="最多 ETF 減碼" tone="down" items={overview.collective.decreases} />
      </div>
    </section>
  );
}

function NewPositionRadar({ overview }: { overview: TodayOverviewViewModel }) {
  return (
    <section aria-label="新倉追蹤雷達" className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">新倉追蹤雷達</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            NEW 後尚未 EXIT、且未滿 20 個交易日的部位。
          </p>
        </div>
        <Radar className="size-5 text-primary" aria-hidden="true" />
      </div>

      {overview.radarPositions.length === 0 ? (
        <EmptyState>目前沒有符合雷達條件的新倉。</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">ETF</th>
                <th className="px-3 py-2 text-left font-medium">股票</th>
                <th className="px-3 py-2 text-left font-medium">進場日</th>
                <th className="px-3 py-2 text-right font-medium">持有交易日</th>
                <th className="px-3 py-2 text-left font-medium">共同訊號</th>
                <th className="px-3 py-2 text-left font-medium">超額報酬</th>
              </tr>
            </thead>
            <tbody>
              {overview.radarPositions.map((position) => (
                <tr key={`${position.etfId}-${position.stockId}`} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 align-top">
                    <div className="font-mono font-semibold tabular-nums">{position.etfId}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{position.etfName}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-mono font-semibold tabular-nums">{position.stockId}</div>
                    <div className="mt-1">{position.stockName}</div>
                  </td>
                  <td className="px-3 py-2 align-top font-mono tabular-nums">{position.entryDate}</td>
                  <td className="px-3 py-2 text-right align-top font-mono tabular-nums">
                    {position.holdingTradingDays}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {position.sharedSignal ? (
                      <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-800">
                        {position.sharedSignal}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top font-mono tabular-nums">
                    {position.excessReturnNote ? (
                      <span className="text-muted-foreground">{position.excessReturnNote}</span>
                    ) : (
                      <span
                        className={
                          Math.abs(position.excessReturnPct ?? 0) >= 10
                            ? position.excessReturnPct! >= 0
                              ? "font-semibold text-[var(--market-up)]"
                              : "font-semibold text-[var(--market-down)]"
                            : undefined
                        }
                      >
                        {formatSignedPct(position.excessReturnPct)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function TodayOverviewDashboard({ overview }: { overview: TodayOverviewViewModel }) {
  return (
    <main className="min-h-screen bg-background">
      <section className="border-b border-border bg-[linear-gradient(180deg,var(--surface-tint)_0%,var(--background)_100%)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">台股主動式股票 ETF</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
                今日總覽
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                看今天誰買進、誰出清，以及哪些個股被多檔主動式 ETF 同步調整。
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <DateSelector
                selectedDate={overview.selectedDate}
                availableDates={overview.availableDates}
                range={overview.range}
              />
              <SiteNav active="overview" />
            </div>
          </div>

          {overview.error ? (
            <Alert className="border-amber-300 bg-amber-50 text-amber-950">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>Supabase 讀取異常</AlertTitle>
              <AlertDescription>{overview.error}</AlertDescription>
            </Alert>
          ) : null}

          <DataGapAlerts warnings={overview.warnings} />
        </div>
      </section>

      <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)] gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <ChangeWall events={overview.changeEvents} />
        <CollectiveMovements overview={overview} />
        <NewPositionRadar overview={overview} />
      </div>
    </main>
  );
}
