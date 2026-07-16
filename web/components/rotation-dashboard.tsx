"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
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
  filterByRange,
  topIndustries,
  type IndustryDaily,
} from "@/lib/rotation";

type RotationDashboardProps = {
  rows: IndustryDaily[];
};

const RANGES = [
  { key: "1M", months: 1 },
  { key: "3M", months: 3 },
  { key: "6M", months: 6 },
  { key: "all", months: null },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

// chart palette: shadcn theme tokens with hex fallbacks
const COLORS = [
  "var(--chart-1, #e05d5d)",
  "var(--chart-2, #4f9cf9)",
  "var(--chart-3, #58b368)",
  "var(--chart-4, #d9a24a)",
  "var(--chart-5, #9d6ff2)",
  "#5bc8c8",
  "#e07db8",
  "#8a9a5b",
];

export function RotationDashboard({ rows }: RotationDashboardProps) {
  const series = useMemo(() => buildRotationSeries(rows), [rows]);
  const [selected, setSelected] = useState<string[]>(() => topIndustries(series, 6));
  const [range, setRange] = useState<RangeKey>("3M");

  const table = useMemo(
    () => buildRotationTable(series, { shortDays: 5, longDays: 20 }),
    [series],
  );
  const visibleSeries = useMemo(() => {
    const months = RANGES.find((r) => r.key === range)?.months;
    if (!months || series.dates.length === 0) return series;
    const from = new Date(series.dates[series.dates.length - 1]);
    from.setMonth(from.getMonth() - months);
    return filterByRange(series, from.toISOString().slice(0, 10));
  }, [series, range]);
  const chartData = useMemo(
    () =>
      visibleSeries.dates.map((date, i) => ({
        date,
        ...Object.fromEntries(
          selected.map((ind) => [ind, visibleSeries.byIndustry[ind]?.[i] ?? null]),
        ),
      })),
    [visibleSeries, selected],
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
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={`rounded-md border px-3 py-1 text-sm transition-colors ${
              range === r.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {r.key === "all" ? "全部" : r.key}
          </button>
        ))}
      </div>
      <div className="h-80 w-full">
        <ResponsiveContainer>
          <LineChart data={chartData}>
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
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
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
