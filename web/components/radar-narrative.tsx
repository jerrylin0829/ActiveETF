"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Radar } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatSignedPct, formatStockLabel, formatYi } from "@/lib/format";
import type {
  RadarEtfLeg,
  RadarNarrative as RadarNarrativeModel,
  RadarSegment,
} from "@/lib/today-overview";
import { cn } from "@/lib/utils";

const segments: Array<{ value: RadarSegment; label: string }> = [
  { value: "multi_add", label: "多 ETF 追買" },
  { value: "single_add", label: "單 ETF 追買" },
  { value: "multi_new", label: "多 ETF 新進" },
  { value: "single_new", label: "單 ETF 新進" },
];

const visibleLimit = 5;

function shortDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}`;
}

function excessTone(leg: RadarEtfLeg): string | undefined {
  if (leg.excessReturnPct === null || Math.abs(leg.excessReturnPct) < 10) {
    return undefined;
  }
  return leg.excessReturnPct >= 0
    ? "font-semibold text-[var(--market-up)]"
    : "font-semibold text-[var(--market-down)]";
}

function EtfLeg({ leg }: { leg: RadarEtfLeg }) {
  const timeline = [
    { tradeDate: leg.entryDate, label: "建倉", tone: "text-foreground" },
    ...leg.followUps.map((event) => ({
      tradeDate: event.tradeDate,
      label: event.changeType === "ADD" ? "加碼" : "減碼",
      tone:
        event.changeType === "ADD"
          ? "text-[var(--market-up)]"
          : "text-[var(--market-down)]",
    })),
  ];

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-4 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(18rem,1.5fr)_7rem_8rem] lg:items-center">
      <Link
        href={`/etf/${encodeURIComponent(leg.etfId)}`}
        className="min-w-0 rounded-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="font-mono text-sm font-semibold tabular-nums">{leg.etfId}</span>
        <span className="ml-2 text-sm font-medium">{leg.etfName}</span>
      </Link>

      <ol
        aria-label={`${leg.etfId} 建倉脈絡`}
        className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 text-sm lg:col-span-1"
      >
        {timeline.map((event) => (
          <li
            key={`${event.tradeDate}-${event.label}`}
            className={cn(
              "relative whitespace-nowrap font-medium after:absolute after:left-[calc(100%+0.45rem)] after:text-muted-foreground after:content-['→'] last:after:content-none",
              event.tone,
            )}
          >
            <span className="font-mono tabular-nums">{shortDate(event.tradeDate)}</span>{" "}
            {event.label}
          </li>
        ))}
      </ol>

      <span className="text-sm text-muted-foreground lg:text-right">
        持有 <span className="font-mono font-medium text-foreground tabular-nums">{leg.holdingTradingDays}</span> 日
      </span>
      <span className={cn("text-right font-mono text-sm tabular-nums", excessTone(leg))}>
        {leg.excessReturnNote ?? formatSignedPct(leg.excessReturnPct)}
      </span>
    </div>
  );
}

export function RadarNarrative({ narratives }: { narratives: RadarNarrativeModel[] }) {
  const [segment, setSegment] = useState<RadarSegment>("multi_add");
  const [expanded, setExpanded] = useState(false);
  const tabRefs = useRef<Partial<Record<RadarSegment, HTMLButtonElement | null>>>({});
  const counts = useMemo(
    () =>
      Object.fromEntries(
        segments.map(({ value }) => [
          value,
          narratives.filter((narrative) => narrative.segment === value).length,
        ]),
      ) as Record<RadarSegment, number>,
    [narratives],
  );
  const filtered = narratives.filter((narrative) => narrative.segment === segment);
  const visible = expanded ? filtered : filtered.slice(0, visibleLimit);
  const hiddenCount = filtered.length - visibleLimit;
  const selectSegment = (nextSegment: RadarSegment) => {
    setSegment(nextSegment);
    setExpanded(false);
  };
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentSegment: RadarSegment,
  ) => {
    const currentIndex = segments.findIndex((option) => option.value === currentSegment);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % segments.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + segments.length) % segments.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = segments.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextSegment = segments[nextIndex].value;
    selectSegment(nextSegment);
    tabRefs.current[nextSegment]?.focus();
  };

  return (
    <section aria-label="新倉追蹤雷達" className="min-w-0 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">新倉追蹤雷達</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            以股票彙整未滿 20 個交易日的建倉，展開各 ETF 後續加減碼脈絡。
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            後續加碼列為脈絡，不另計為一次建倉；加減碼事件已濾除申贖造成的等比例變動。
          </p>
        </div>
        <Radar className="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" />
      </div>

      <div
        role="tablist"
        aria-label="雷達分類"
        className="flex max-w-full gap-2 overflow-x-auto pb-1"
      >
        {segments.map((option) => (
          <button
            key={option.value}
            ref={(element) => {
              tabRefs.current[option.value] = element;
            }}
            type="button"
            role="tab"
            id={`radar-tab-${option.value}`}
            aria-controls="radar-narrative-panel"
            aria-selected={segment === option.value}
            tabIndex={segment === option.value ? 0 : -1}
            onClick={() => selectSegment(option.value)}
            onKeyDown={(event) => handleTabKeyDown(event, option.value)}
            className={cn(
              "shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              segment === option.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {option.label} {counts[option.value]}
          </button>
        ))}
      </div>

      <div
        id="radar-narrative-panel"
        role="tabpanel"
        aria-labelledby={`radar-tab-${segment}`}
      >
        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            此分類目前沒有符合雷達條件的新倉。
          </div>
        ) : (
          <div className="space-y-3">
          {visible.map((narrative) => (
            <article
              key={narrative.stockId}
              data-testid={`radar-narrative-${narrative.stockId}`}
              className="min-w-0 overflow-hidden rounded-md border border-border bg-card"
            >
              <div className="border-b border-border bg-muted/25 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Link
                      href={`/stock/${encodeURIComponent(narrative.stockId)}`}
                      className="rounded-sm font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {formatStockLabel(narrative.stockId, narrative.stockName)}
                    </Link>
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      {narrative.industry ?? "未分類"}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium">
                    {narrative.etfCount} 檔 ETF / {narrative.issuerCount} 家投信建倉，後續加碼{" "}
                    {narrative.followUpCount} 筆
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-muted-foreground tabular-nums">
                  <span>估算新進 {formatYi(narrative.entryValueTwd)}</span>
                  <span>估算加碼 {formatYi(narrative.addValueTwd)}</span>
                </div>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_8rem] border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground lg:grid-cols-[minmax(12rem,0.8fr)_minmax(18rem,1.5fr)_7rem_8rem]">
                <span>建倉 ETF</span>
                <span className="hidden lg:block">建倉脈絡</span>
                <span className="hidden text-right lg:block">持有交易日</span>
                <span className="text-right">建倉以來超額</span>
              </div>
              <div className="divide-y divide-border/70">
                {narrative.legs.map((leg) => (
                  <EtfLeg key={`${leg.etfId}-${leg.entryDate}`} leg={leg} />
                ))}
              </div>
            </article>
          ))}

          {filtered.length > visibleLimit ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {expanded ? (
                <>
                  <ChevronUp className="size-4" aria-hidden="true" />
                  收合
                </>
              ) : (
                <>
                  <ChevronDown className="size-4" aria-hidden="true" />
                  查看更多（{hiddenCount}）
                </>
              )}
            </button>
          ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
