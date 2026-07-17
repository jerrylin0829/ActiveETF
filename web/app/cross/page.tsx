import { CrossHoldingsTable } from "@/components/cross-holdings-table";
import { SiteNav } from "@/components/site-nav";
import { Button } from "@/components/ui/button";
import { fetchCrossHoldings } from "@/lib/cross-holdings-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CrossPageProps = {
  searchParams?: Promise<{ date?: string }>;
};

export default async function CrossPage({ searchParams }: CrossPageProps) {
  const params = await searchParams;
  const result = await fetchCrossHoldings(params?.date);

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 p-4 md:p-8">
      <header className="grid gap-3">
        <SiteNav active="cross" />
        <h1 className="text-2xl font-semibold text-foreground">交集表</h1>
        <p className="text-sm text-muted-foreground">
          全部主動式股票型 ETF 的持股交集：每檔股票被幾檔 ETF 持有、合計權重與當日異動。點列可展開持有明細。
        </p>
        <form action="/cross" className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-medium text-muted-foreground">
            交易日
            <select
              name="date"
              defaultValue={result.date ?? ""}
              className="h-9 min-w-40 rounded-md border border-input bg-card px-3 font-mono text-sm text-foreground shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {result.availableDates.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="outline" size="lg">
            切換日期
          </Button>
        </form>
        {result.error && (
          <p className="rounded-md border border-yellow-600/40 bg-yellow-500/10 p-3 text-sm text-foreground">
            資料載入部分失敗：{result.error}
          </p>
        )}
        {result.date && result.etfCountThatDay < result.etfCountTotal && (
          <p className="rounded-md border border-yellow-600/40 bg-yellow-500/10 p-3 text-sm text-foreground">
            本表基於 {result.etfCountThatDay}/{result.etfCountTotal} 檔 ETF 資料，部分 ETF
            當日缺快照。
          </p>
        )}
      </header>
      <CrossHoldingsTable rows={result.rows} details={result.details} />
    </main>
  );
}
