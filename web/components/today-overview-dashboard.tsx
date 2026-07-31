import Link from "next/link";
import { AlertCircle, ArrowDownRight, ArrowUpRight } from "lucide-react";

import { ChangeWall } from "@/components/change-wall";
import { DataGapAlerts } from "@/components/data-gap-alerts";
import { DateSelector } from "@/components/date-selector";
import { RadarNarrative } from "@/components/radar-narrative";
import { formatStockLabel, formatYi } from "@/lib/format";
import { SiteNav } from "@/components/site-nav";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { type CollectiveMove, type TodayOverviewViewModel } from "@/lib/today-overview";
import { cn } from "@/lib/utils";

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
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_5.25rem_6rem] gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
        <span>排名</span>
        <span>股票</span>
        <span className="text-right">ETF 檔數</span>
        <span className="text-right">合計金額</span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">此區間沒有資料。</div>
      ) : (
        <ol className="divide-y divide-border">
          {items.map((item, index) => (
            <li
              key={item.stockId}
              className="grid grid-cols-[2rem_minmax(0,1fr)_5.25rem_6rem] items-center gap-2 px-4 py-3"
            >
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 font-medium">
                {formatStockLabel(item.stockId, item.stockName)}
              </span>
              <span className="text-right text-xs text-muted-foreground">
                {item.etfCount} 檔 ETF
              </span>
              <span
                className={cn(
                  "text-right font-mono text-sm font-semibold tabular-nums",
                  toneClass,
                )}
              >
                {formatYi(item.totalValueTwd)}
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
          <p className="mt-1 text-sm text-muted-foreground">依 ETF 檔數排序，再比合計金額。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {overview.rangeOptions.map((option) => (
            <Link
              key={option.value}
              href={option.href}
              scroll={false}
              data-testid={`range-link-${option.value}`}
              data-scroll="false"
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
              {overview.availableDates[0] ? (
                <p className="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
                  資料更新至 {overview.availableDates[0]}
                </p>
              ) : null}
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
        <RadarNarrative narratives={overview.radarNarratives} />
      </div>
    </main>
  );
}
