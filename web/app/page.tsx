import { TodayOverviewDashboard } from "@/components/today-overview-dashboard";
import { fetchTodayOverview } from "@/lib/today-overview-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HomePageProps = {
  searchParams?: Promise<{
    date?: string;
    range?: string;
  }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const overview = await fetchTodayOverview({
    date: params?.date,
    range: params?.range,
  });

  return <TodayOverviewDashboard overview={overview} />;
}
