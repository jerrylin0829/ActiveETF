import { AlertCircle } from "lucide-react";

import { RankingsTable } from "@/components/rankings-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fetchRankingRows } from "@/lib/rankings-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RankingsPage() {
  const result = await fetchRankingRows();
  const latestTradeDate = result.rows[0]?.tradeDate ?? null;

  return (
    <main className="min-h-screen bg-background">
      <section className="border-b border-border bg-[linear-gradient(180deg,var(--surface-tint)_0%,var(--background)_100%)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">台股主動式股票 ETF</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
                ETF 排行榜
              </h1>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:flex">
              <div className="rounded-md border border-border bg-card px-4 py-3">
                <div className="text-xs text-muted-foreground">列入檔數</div>
                <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {result.rows.length}
                </div>
              </div>
              <div className="rounded-md border border-border bg-card px-4 py-3">
                <div className="text-xs text-muted-foreground">最新日期</div>
                <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
                  {latestTradeDate ?? "—"}
                </div>
              </div>
            </div>
          </div>

          {result.error ? (
            <Alert className="border-amber-300 bg-amber-50 text-amber-950">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>Supabase 讀取異常</AlertTitle>
              <AlertDescription>{result.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <RankingsTable rows={result.rows} error={result.error} />
      </section>
    </main>
  );
}
