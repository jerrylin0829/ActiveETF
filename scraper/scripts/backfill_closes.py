"""One-off raw-close backfill for stocks already held in snapshots.

Historic stock_price rows were cached with adj_close only (close was null),
so cross_holdings_daily.total_value_twd could not be computed. Refetch every
held stock over the snapshot date range and upsert both closes, then rerun
scripts/backfill_aggregates.py to fill the value column. Safe to rerun.

Usage:  set -a && source .env.local && set +a
        uv run python scripts/backfill_closes.py
"""
import time

from activeetf import db, finmind


def main() -> None:
    with db.conn() as c:
        start, end = c.execute(
            "select min(trade_date), max(trade_date) from holdings_snapshot").fetchone()
        stock_ids = [r[0] for r in c.execute(
            "select distinct stock_id from holdings_snapshot order by 1").fetchall()]
    print(f"backfilling raw closes for {len(stock_ids)} stocks, {start} ~ {end}")
    misses = 0
    for i, sid in enumerate(stock_ids, 1):
        rows = finmind.adj_prices(sid, str(start), str(end))
        if rows:
            db.upsert_prices([(r["stock_id"], r["date"], r.get("raw_close"), r["close"])
                              for r in rows])
        else:
            misses += 1   # foreign holdings etc.; value stays null by design
        if i % 50 == 0:
            print(f"{i}/{len(stock_ids)} done ({misses} without data)")
        time.sleep(1)
    print(f"finished: {len(stock_ids)} stocks, {misses} without data")


if __name__ == "__main__":
    main()
