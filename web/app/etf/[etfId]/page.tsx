import { AlertCircle } from "lucide-react";
import { notFound } from "next/navigation";

import { ChangeTimeline } from "@/components/etf-detail/change-timeline";
import { HoldingsTable } from "@/components/etf-detail/holdings-table";
import { IndustryPieChart } from "@/components/etf-detail/industry-pie-chart";
import { PerformanceSummary } from "@/components/etf-detail/performance-summary";
import { WeightHistoryChart } from "@/components/etf-detail/weight-history-chart";
import { DataGapAlerts } from "@/components/data-gap-alerts";
import { SiteNav } from "@/components/site-nav";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fetchEtfDetail } from "@/lib/etf-detail-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type EtfDetailPageProps = {
  params: Promise<{ etfId: string }>;
  searchParams?: Promise<{ stock?: string }>;
};

const emptySearchParams: Promise<{ stock?: string }> = Promise.resolve({});

export default async function EtfDetailPage({
  params,
  searchParams,
}: EtfDetailPageProps) {
  const [{ etfId }, query] = await Promise.all([
    params,
    searchParams ?? emptySearchParams,
  ]);
  const result = await fetchEtfDetail(etfId, query.stock);

  if (!result.found) {
    if (!result.error) notFound();
    return (
      <main className="min-h-screen bg-background px-4 py-10 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <Alert className="border-amber-300 bg-amber-50 text-amber-950">
            <AlertCircle className="size-4" aria-hidden="true" />
            <AlertTitle>Supabase 讀取異常</AlertTitle>
            <AlertDescription>{result.error}</AlertDescription>
          </Alert>
        </div>
      </main>
    );
  }

  const detail = result.detail;

  return (
    <main className="min-h-screen bg-background">
      <section className="border-b border-border bg-[linear-gradient(180deg,var(--surface-tint)_0%,var(--background)_100%)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-muted-foreground">{detail.issuer}</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
                <span className="font-mono tabular-nums">{detail.etfId}</span>{" "}
                {detail.name}
              </h1>
            </div>
            <div className="flex flex-col gap-3 lg:items-end">
              <SiteNav />
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">最新快照</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums">
                    {detail.latestDate ?? "—"}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">持股檔數</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                    {detail.holdings.length}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {detail.error ? (
            <Alert className="border-amber-300 bg-amber-50 text-amber-950">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>部分資料讀取異常</AlertTitle>
              <AlertDescription>{detail.error}</AlertDescription>
            </Alert>
          ) : null}
          <DataGapAlerts warnings={detail.warnings} />
        </div>
      </section>

      <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)] gap-10 px-4 py-8 sm:px-6 lg:px-8">
        <PerformanceSummary metric={detail.metric} />
        <HoldingsTable
          etfId={detail.etfId}
          rows={detail.holdings}
          selectedStockId={detail.selectedStockId}
          previousDate={detail.previousDate}
          twentyDayDate={detail.twentyDayDate}
        />
        <div className="grid min-w-0 gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <IndustryPieChart industries={detail.industries} />
          <ChangeTimeline events={detail.changes} />
        </div>
        <WeightHistoryChart
          stockId={detail.selectedStockId}
          stockName={detail.selectedStockName}
          points={detail.weightHistory}
        />
      </div>
    </main>
  );
}
