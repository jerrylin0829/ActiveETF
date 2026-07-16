import { RotationDashboard } from "@/components/rotation-dashboard";
import { SiteNav } from "@/components/site-nav";
import { fetchRotationData } from "@/lib/rotation-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RotationPage() {
  const result = await fetchRotationData();
  const latest = result.rows[result.rows.length - 1];

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 p-4 md:p-8">
      <header className="grid gap-3">
        <SiteNav active="rotation" />
        <h1 className="text-2xl font-semibold text-foreground">產業權重輪動</h1>
        <p className="text-sm text-muted-foreground">
          全體主動式股票型 ETF 的平均產業配置隨時間變化：資金正從哪個產業流向哪個產業。點圖例或表格列可增減曲線。
        </p>
        {result.error && (
          <p className="rounded-md border border-yellow-600/40 bg-yellow-500/10 p-3 text-sm text-foreground">
            資料載入部分失敗：{result.error}
          </p>
        )}
        {latest && latest.etfCountTotal < result.etfCountTotal && (
          <p className="rounded-md border border-yellow-600/40 bg-yellow-500/10 p-3 text-sm text-foreground">
            最新交易日基於 {latest.etfCountTotal}/{result.etfCountTotal} 檔 ETF 資料。
          </p>
        )}
      </header>
      <RotationDashboard rows={result.rows} />
    </main>
  );
}
