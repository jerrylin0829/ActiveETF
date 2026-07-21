"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  filterStockTrendRange,
  type StockLookupRange,
  type StockTrendPoint,
} from "@/lib/stock-lookup";
import { cn } from "@/lib/utils";

const ranges: Array<{ key: StockLookupRange; label: string }> = [
  { key: "1M", label: "1M" },
  { key: "3M", label: "3M" },
  { key: "6M", label: "6M" },
  { key: "all", label: "全部" },
];

export function AggregateTrendChart({
  stockId,
  points,
  range,
}: {
  stockId: string;
  points: StockTrendPoint[];
  range: StockLookupRange;
}) {
  const displayed = useMemo(() => filterStockTrendRange(points, range), [points, range]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateWidth = () => setChartWidth(Math.floor(container.getBoundingClientRect().width));
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
    <section aria-labelledby="aggregate-trend-title" className="min-w-0 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="aggregate-trend-title" className="text-xl font-semibold">全體合計權重走勢</h2>
          <p className="mt-1 text-sm text-muted-foreground">合計權重與持有 ETF 檔數</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ranges.map((item) => (
            <Link
              key={item.key}
              href={`/stock/${encodeURIComponent(stockId)}?range=${item.key}`}
              prefetch={false}
              aria-current={range === item.key ? "page" : undefined}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                range === item.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      {points.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          尚無合計權重走勢
        </div>
      ) : (
        <div ref={containerRef} className="h-80 w-full min-w-0" data-testid="stock-trend-chart">
          {chartWidth > 0 ? (
            <LineChart width={chartWidth} height={320} data={displayed}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="tradeDate" fontSize={12} minTickGap={40} />
              <YAxis
                yAxisId="weight"
                data-y-axis-id="weight"
                fontSize={12}
                unit="%"
                width={48}
              />
              <YAxis
                yAxisId="count"
                data-y-axis-id="count"
                orientation="right"
                allowDecimals={false}
                fontSize={12}
                width={36}
              />
              <Tooltip
                formatter={(value, name) =>
                  name === "合計權重"
                    ? [`${Number(value).toFixed(2)}%`, name]
                    : [`${Number(value)} 檔`, name]
                }
              />
              <Legend />
              <Line
                yAxisId="weight"
                dataKey="totalWeightPct"
                name="合計權重"
                type="monotone"
                stroke="var(--market-up)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="count"
                dataKey="etfCount"
                name="持有 ETF 檔數"
                type="stepAfter"
                stroke="var(--rotation-chart-2)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              {displayed.length === 1 ? (
                <>
                  <ReferenceDot
                    yAxisId="weight"
                    x={displayed[0].tradeDate}
                    y={displayed[0].totalWeightPct}
                    r={4}
                    fill="var(--market-up)"
                    stroke="var(--market-up)"
                  />
                  <ReferenceDot
                    yAxisId="count"
                    x={displayed[0].tradeDate}
                    y={displayed[0].etfCount}
                    r={4}
                    fill="var(--rotation-chart-2)"
                    stroke="var(--rotation-chart-2)"
                  />
                </>
              ) : null}
            </LineChart>
          ) : null}
        </div>
      )}
    </section>
  );
}
