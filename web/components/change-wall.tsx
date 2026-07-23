"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { formatStockLabel } from "@/lib/format";
import {
  filterChangeWall,
  formatSharesDelta,
  formatWeightDelta,
  type ChangeEvent,
  type ChangeWallTab,
  type MarketFilter,
} from "@/lib/today-overview";
import { cn } from "@/lib/utils";

const changeLabels: Record<ChangeEvent["changeType"], string> = {
  NEW: "NEW",
  EXIT: "EXIT",
  ADD: "ADD",
  TRIM: "TRIM",
};

const tabs: Array<{ value: ChangeWallTab; label: string }> = [
  { value: "build_exit", label: "建倉出清" },
  { value: "add_trim", label: "加減碼" },
];

const markets: Array<{ value: MarketFilter; label: string }> = [
  { value: "tw", label: "台股" },
  { value: "overseas", label: "海外" },
];

const visibleLimit = 5;

function changeTone(changeType: ChangeEvent["changeType"]): string {
  return changeType === "NEW" || changeType === "ADD"
    ? "text-[var(--market-up)]"
    : "text-[var(--market-down)]";
}

function badgeTone(changeType: ChangeEvent["changeType"]): string {
  return changeType === "NEW" || changeType === "ADD"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div aria-label={label} className="flex gap-2" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
            value === option.value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ChangeWall({ events }: { events: ChangeEvent[] }) {
  const [tab, setTab] = useState<ChangeWallTab>("build_exit");
  const [market, setMarket] = useState<MarketFilter>("tw");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(
    () => filterChangeWall(events, tab, market),
    [events, market, tab],
  );
  const visible = expanded ? filtered : filtered.slice(0, visibleLimit);
  const hiddenCount = filtered.length - visibleLimit;

  return (
    <section aria-labelledby="change-wall-title" className="min-w-0 space-y-3">
      <div>
        <h2 id="change-wall-title" className="text-xl font-semibold">
          異動牆
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          列出選定交易日各主動式 ETF 的持股異動事件，可依事件類型與市場切換檢視。
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          新進 NEW＝首次買進｜出清 EXIT＝完全賣出｜加碼 ADD＝增持｜減碼 TRIM＝減持
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="事件類型"
          options={tabs}
          value={tab}
          onChange={(nextTab) => {
            setTab(nextTab);
            setExpanded(false);
          }}
        />
        <SegmentedControl
          label="市場"
          options={markets}
          value={market}
          onChange={(nextMarket) => {
            setMarket(nextMarket);
            setExpanded(false);
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          此分類當日無異動。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="divide-y divide-border">
            {visible.map((event) => (
              <article
                key={`${event.etfId}-${event.stockId}-${event.changeType}`}
                data-testid="change-row"
                className="grid gap-3 px-4 py-3 sm:grid-cols-[6rem_minmax(0,1fr)_8rem_8rem] sm:items-center"
              >
                <div>
                  <Badge variant="outline" className={badgeTone(event.changeType)}>
                    {changeLabels[event.changeType]}
                  </Badge>
                </div>
                <div className="min-w-0">
                  <Link
                    href={`/stock/${encodeURIComponent(event.stockId)}`}
                    className="rounded-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {formatStockLabel(event.stockId, event.stockName)}
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">
                    <Link
                      href={`/etf/${encodeURIComponent(event.etfId)}`}
                      className="rounded-sm font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {event.etfId} {event.etfName}
                    </Link>
                  </div>
                </div>
                <div
                  className={cn(
                    "font-mono text-sm font-semibold tabular-nums",
                    changeTone(event.changeType),
                  )}
                >
                  {formatSharesDelta(event.sharesDelta)}
                </div>
                <div
                  className={cn(
                    "font-mono text-sm font-semibold tabular-nums",
                    changeTone(event.changeType),
                  )}
                >
                  {formatWeightDelta(event.weightDeltaPct)}
                </div>
              </article>
            ))}
          </div>

          {filtered.length > visibleLimit ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="flex w-full items-center justify-center gap-2 border-t border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
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
    </section>
  );
}
