import { AlertCircle } from "lucide-react";
import { notFound } from "next/navigation";

import { DataGapAlerts } from "@/components/data-gap-alerts";
import { SiteNav } from "@/components/site-nav";
import { AggregateTrendChart } from "@/components/stock-lookup/aggregate-trend-chart";
import { HoldersTable } from "@/components/stock-lookup/holders-table";
import { StockEventHistory } from "@/components/stock-lookup/stock-event-history";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatStockLabel } from "@/lib/format";
import { fetchStockLookup } from "@/lib/stock-lookup-data";
import { normalizeStockLookupRange } from "@/lib/stock-lookup";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StockLookupPageProps = {
  params: Promise<{ stockId: string }>;
  searchParams?: Promise<{ range?: string }>;
};

const emptySearchParams: Promise<{ range?: string }> = Promise.resolve({});

export default async function StockLookupPage({
  params,
  searchParams,
}: StockLookupPageProps) {
  const [{ stockId }, query] = await Promise.all([
    params,
    searchParams ?? emptySearchParams,
  ]);
  const result = await fetchStockLookup(decodeURIComponent(stockId));

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
  const range = normalizeStockLookupRange(query.range);

  return (
    <main className="min-h-screen bg-background">
      <section className="border-b border-border bg-[linear-gradient(180deg,var(--surface-tint)_0%,var(--background)_100%)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-muted-foreground">{detail.industry}</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
                <span className="font-mono tabular-nums">
                  {formatStockLabel(detail.stockId, detail.stockName)}
                </span>
              </h1>
            </div>
            <div className="flex flex-col gap-3 lg:items-end">
              <SiteNav />
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">最新交易日</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums">
                    {detail.latestDate ?? "—"}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">持有 ETF</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                    {detail.latestEtfCount} 檔
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
        <HoldersTable rows={detail.holders} latestDate={detail.latestDate} />
        <AggregateTrendChart stockId={detail.stockId} points={detail.trend} range={range} />
        <StockEventHistory events={detail.events} />
        <p role="note" className="border-t border-border pt-4 text-xs text-muted-foreground">
          同一公司若在來源資料中使用不同代號，本站會將不同代號視為不同股票，暫不合併統計。
        </p>
      </div>
    </main>
  );
}
