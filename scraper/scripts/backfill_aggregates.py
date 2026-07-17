"""One-off backfill: recompute both daily aggregate tables for every date that
has snapshots. Safe to rerun (refresh_daily_aggregates is idempotent).

Usage:  set -a && source .env.local && set +a
        uv run python scripts/backfill_aggregates.py
"""
from activeetf import db


def main() -> None:
    with db.conn() as c:
        dates = [r[0] for r in c.execute(
            "select distinct trade_date from holdings_snapshot order by 1").fetchall()]
    print(f"backfilling {len(dates)} dates")
    for d in dates:
        db.refresh_daily_aggregates(d)
        print(f"{d} ok")


if __name__ == "__main__":
    main()
