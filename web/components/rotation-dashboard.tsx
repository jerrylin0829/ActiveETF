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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPct, formatSignedPct } from "@/lib/format";
import {
  buildRotationSeries,
  buildRotationTable,
  topIndustries,
  type IndustryDaily,
  type RotationRange,
} from "@/lib/rotation";

type RotationDashboardProps = {
  rows: IndustryDaily[];
  range?: RotationRange;
};

const RANGES = [
  { key: "1M", months: 1 },
  { key: "3M", months: 3 },
  { key: "6M", months: 6 },
  { key: "all", months: null },
] as const;
const COLORS = [
  "var(--rotation-chart-1)",
  "var(--rotation-chart-2)",
  "var(--rotation-chart-3)",
  "var(--rotation-chart-4)",
  "var(--rotation-chart-5)",
  "var(--rotation-chart-6)",
  "var(--rotation-chart-7)",
  "var(--rotation-chart-8)",
];

export function RotationDashboard({ rows, range = "3M" }: RotationDashboardProps) {
  const series = useMemo(() => buildRotationSeries(rows), [rows]);
  const [selected, setSelected] = useState<string[]>(() => topIndustries(series, 6));
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const updateWidth = () => setChartWidth(Math.floor(container.getBoundingClientRect().width));
    updateWidth();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateWidth);
    observer?.observe(container);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  const table = useMemo(
    () => buildRotationTable(series, { shortDays: 5, longDays: 20 }),
    [series],
  );
  const chartData = useMemo(
    () =>
      series.dates.map((date, i) => ({
        date,
        ...Object.fromEntries(selected.map((ind) => [ind, series.byIndustry[ind]?.[i] ?? null])),
      })),
    [series, selected],
  );

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        尚無彙總資料。
      </p>
    );
  }

  const toggle = (industry: string) =>
    setSelected((s) => (s.includes(industry) ? s.filter((i) => i !== industry) : [...s, industry]));

  const changeCell = (v: number | null) => (
    // 紅漲綠跌: same CSS vars as changeTone() in today-overview-dashboard.tsx
    <TableCell
      className={`tabular-nums ${
        v === null ? "" : v >= 0 ? "text-[var(--market-up)]" : "text-[var(--market-down)]"
      }`}
    >
      {formatSignedPct(v)}
    </TableCell>
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Link
            key={r.key}
            href={`/rotation?range=${r.key}`}
            prefetch={false}
            aria-current={range === r.key ? "page" : undefined}
            className={`rounded-md border px-3 py-1 text-sm transition-colors ${
              range === r.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {r.key === "all" ? "全部" : r.key}
          </Link>
        ))}
      </div>
      <div ref={chartContainerRef} className="h-80 w-full min-w-0">
        {chartWidth > 0 && (
          <LineChart width={chartWidth} height={320} data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" fontSize={12} minTickGap={40} />
            <YAxis fontSize={12} unit="%" width={48} />
            <Tooltip formatter={(v) => (typeof v === "number" ? `${v.toFixed(2)}%` : "—")} />
            <Legend onClick={(e) => e.value && toggle(String(e.value))} />
            {selected.map((ind, i) => (
              <Line
                key={ind}
                dataKey={ind}
                dot={false}
                type="monotone"
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                isAnimationActive={false}
              />
            ))}
            {series.dates.length === 1 &&
              selected.map((industry, index) => {
                const value = series.byIndustry[industry]?.[0];
                return value === null || value === undefined ? null : (
                  <ReferenceDot
                    key={`single-${industry}`}
                    x={series.dates[0]}
                    y={value}
                    r={4}
                    fill={COLORS[index % COLORS.length]}
                    stroke={COLORS[index % COLORS.length]}
                  />
                );
              })}
          </LineChart>
        )}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>產業</TableHead>
              <TableHead>當日平均權重</TableHead>
              <TableHead>5 日變化</TableHead>
              <TableHead>20 日變化</TableHead>
              <TableHead className="hidden sm:table-cell">持股檔數</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.map((r) => (
              <TableRow
                key={r.industry}
                data-testid="rotation-row"
                data-selected={selected.includes(r.industry)}
                className="cursor-pointer"
                onClick={() => toggle(r.industry)}
              >
                <TableCell>{r.industry}</TableCell>
                <TableCell className="tabular-nums">{formatPct(r.latestAvgPct)}</TableCell>
                {changeCell(r.shortChangePct)}
                {changeCell(r.longChangePct)}
                <TableCell className="hidden tabular-nums sm:table-cell">{r.stockCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
