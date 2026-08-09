type OrderableQuery = {
  order(
    column: string,
    options: { ascending: boolean },
  ): OrderableQuery;
};

export function orderRecentScrapeLogs<T extends OrderableQuery>(query: T): T {
  return query
    .order("trade_date", { ascending: false })
    .order("run_at", { ascending: false })
    .order("id", { ascending: false }) as T;
}
