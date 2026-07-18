"use client";

import { useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatPct } from "@/lib/format";
import type { WeightHistoryPoint } from "@/lib/etf-detail";

export function WeightHistoryChart({
  stockId,
  stockName,
  points,
}: {
  stockId: string | null;
  stockName: string | null;
  points: WeightHistoryPoint[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateWidth = () => setWidth(Math.floor(container.getBoundingClientRect().width));
    updateWidth();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateWidth);
    observer?.observe(container);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  const nonNullPoints = points.filter((point) => point.weightPct !== null);
  const title = stockId ? `${stockId} ${stockName ?? stockId}權重歷史` : "持股權重歷史";

  return (
    <section id="weight-history" aria-labelledby="weight-history-title" className="min-w-0 scroll-mt-4 space-y-3">
      <div>
        <h2 id="weight-history-title" className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">全期快照</p>
      </div>
      {!stockId || nonNullPoints.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          尚無持股權重歷史
        </div>
      ) : (
        <div ref={containerRef} className="h-80 min-w-0">
          {width > 0 ? (
            <LineChart width={width} height={320} data={points}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="tradeDate" fontSize={12} minTickGap={40} />
              <YAxis fontSize={12} unit="%" width={48} domain={[0, "auto"]} />
              <Tooltip formatter={(value) => formatPct(typeof value === "number" ? value : null)} />
              <Line
                type="monotone"
                dataKey="weightPct"
                stroke="var(--rotation-chart-2)"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              {nonNullPoints.length === 1 ? (
                <ReferenceDot
                  x={nonNullPoints[0].tradeDate}
                  y={nonNullPoints[0].weightPct!}
                  r={4}
                  fill="var(--rotation-chart-2)"
                  stroke="var(--rotation-chart-2)"
                />
              ) : null}
            </LineChart>
          ) : null}
        </div>
      )}
    </section>
  );
}
