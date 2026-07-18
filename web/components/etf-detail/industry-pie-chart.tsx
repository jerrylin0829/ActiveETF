"use client";

import { useEffect, useRef, useState } from "react";
import { Cell, Pie, PieChart, Tooltip } from "recharts";

import { formatPct } from "@/lib/format";
import type { IndustryWeight } from "@/lib/etf-detail";

const colors = Array.from({ length: 8 }, (_, index) => `var(--rotation-chart-${index + 1})`);

export function IndustryPieChart({ industries }: { industries: IndustryWeight[] }) {
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

  return (
    <section aria-labelledby="industry-pie-title" className="min-w-0 space-y-3">
      <div>
        <h2 id="industry-pie-title" className="text-xl font-semibold">產業配置</h2>
        <p className="mt-1 text-xs text-muted-foreground">最新持股權重</p>
      </div>
      {industries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          尚無持股可供分類
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_13rem] sm:items-center">
          <div ref={containerRef} className="h-72 min-w-0">
            {width > 0 ? (
              <PieChart width={width} height={288}>
                <Pie
                  data={industries}
                  dataKey="weightPct"
                  nameKey="industry"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={105}
                  isAnimationActive={false}
                >
                  {industries.map((industry, index) => (
                    <Cell key={industry.industry} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => formatPct(typeof value === "number" ? value : null)}
                />
              </PieChart>
            ) : null}
          </div>
          <ul className="grid gap-2 text-sm">
            {industries.map((industry, index) => (
              <li key={industry.industry} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                <span
                  className="size-2.5 rounded-sm"
                  style={{ backgroundColor: colors[index % colors.length] }}
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate">{industry.industry}</span>
                <span className="font-mono tabular-nums">{formatPct(industry.weightPct)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
