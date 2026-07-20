import { Badge } from "@/components/ui/badge";
import { PickingDisclosure } from "@/components/picking-disclosure";
import {
  buildPickingSummary,
  formatNumber,
  formatReturn,
  formatTurnover,
  formatWinRate,
  getReturnTone,
  type RankingRow,
  type ReturnField,
} from "@/lib/rankings";
import { cn } from "@/lib/utils";

const returnItems: Array<{
  field: ReturnField;
  benchmark: keyof RankingRow | null;
  label: string;
}> = [
  { field: "ret1m", benchmark: "bench00501m", label: "1 個月" },
  { field: "ret3m", benchmark: "bench00503m", label: "3 個月" },
  { field: "ret6m", benchmark: "bench00506m", label: "6 個月" },
  { field: "ret1y", benchmark: "bench00501y", label: "1 年" },
  { field: "retInception", benchmark: null, label: "上市以來" },
];

function returnToneClass(row: RankingRow, field: ReturnField): string {
  const tone = getReturnTone(row, field);
  if (tone === "beat-positive") return "text-[var(--market-up)]";
  if (tone === "beat-negative") return "text-[var(--market-down)]";
  return "text-foreground";
}

function PickingMetric({ label, wins, total }: { label: string; wins: number; total: number }) {
  const summary = buildPickingSummary(wins, total);
  return (
    <div className={cn("min-w-0 px-4 py-3", summary.insufficient && "text-muted-foreground")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <span className="mt-1 block font-mono text-sm font-semibold tabular-nums">
        {summary.label}
      </span>
      {summary.insufficient ? (
        <Badge variant="outline" className="mt-2 border-amber-300 bg-amber-50 text-amber-800">
          樣本不足
        </Badge>
      ) : null}
    </div>
  );
}

export function PerformanceSummary({ metric }: { metric: RankingRow | null }) {
  return (
    <section aria-labelledby="performance-title" className="min-w-0 space-y-3">
      <div>
        <h2 id="performance-title" className="text-xl font-semibold">績效與操作風格</h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
          指標日期 {metric?.tradeDate ?? "—"}
        </p>
      </div>

      {!metric ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          尚無 ETF 指標快取
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-5">
            {returnItems.map((item) => {
              const benchmark = item.benchmark ? metric[item.benchmark] as number | null : null;
              return (
                <div
                  key={item.field}
                  data-testid={`performance-${item.field}`}
                  className="min-w-0 px-4 py-3"
                >
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                  <div className={cn(
                    "mt-1 font-mono text-lg font-semibold tabular-nums",
                    returnToneClass(metric, item.field),
                  )}>
                    {formatReturn(metric[item.field])}
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
                    {item.benchmark ? `0050 ${formatReturn(benchmark)}` : "—"}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid border-t border-border divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-5">
            <div className="min-w-0 px-4 py-3">
              <div className="text-xs text-muted-foreground">擇時勝率</div>
              <span className="mt-1 block font-mono text-sm font-semibold tabular-nums">
                {formatWinRate(metric.timingWins, metric.timingMonths)}
              </span>
            </div>
            <PickingMetric
              label="選股已實現"
              wins={metric.pickingRealizedWins}
              total={metric.pickingRealizedTotal}
            />
            <PickingMetric
              label="選股未平倉"
              wins={metric.pickingOpenWins}
              total={metric.pickingOpenTotal}
            />
            <div className="min-w-0 px-4 py-3">
              <div className="text-xs text-muted-foreground">持有中位數</div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {formatNumber(metric.medianHoldingDays, " 天")}
              </div>
            </div>
            <div className="min-w-0 px-4 py-3">
              <div className="text-xs text-muted-foreground">週換手率</div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {formatTurnover(metric.weeklyTurnoverPct)}
              </div>
            </div>
          </div>
          <PickingDisclosure />
        </div>
      )}
    </section>
  );
}
