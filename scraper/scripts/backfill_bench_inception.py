"""Backfill aligned 0050 inception returns for every etf_metrics row.

Uses only cached adjusted prices in stock_price. Safe to rerun after migration 005.

Usage:  set -a && source .env.local && set +a
        uv run python scripts/backfill_bench_inception.py
"""
import datetime as dt

from activeetf import db, metrics


def build_updates(
    metric_rows: list[tuple[str, dt.date]],
    benchmark: metrics.Series,
    etf_series: dict[str, metrics.Series],
) -> list[tuple[float | None, str, dt.date]]:
    return [
        (
            metrics.benchmark_inception_return(
                benchmark,
                etf_series.get(etf_id, {}),
                trade_date,
            ),
            etf_id,
            trade_date,
        )
        for etf_id, trade_date in metric_rows
    ]


def main() -> None:
    with db.conn() as c:
        metric_rows = [
            (row[0], row[1])
            for row in c.execute(
                "select etf_id, trade_date from etf_metrics order by etf_id, trade_date"
            ).fetchall()
        ]
        if not metric_rows:
            print("no etf_metrics rows to backfill")
            return

        stock_ids = ["0050", *sorted({etf_id for etf_id, _ in metric_rows})]
        price_rows = c.execute(
            """select stock_id, trade_date, adj_close
               from stock_price
               where stock_id = any(%s) and adj_close is not null
               order by stock_id, trade_date""",
            (stock_ids,),
        ).fetchall()

        series: dict[str, metrics.Series] = {}
        for stock_id, trade_date, adj_close in price_rows:
            series.setdefault(stock_id, {})[trade_date] = float(adj_close)

        updates = build_updates(metric_rows, series.get("0050", {}), series)
        with c.transaction(), c.cursor() as cur:
            cur.executemany(
                """update etf_metrics
                   set bench_0050_inception=%s
                   where etf_id=%s and trade_date=%s""",
                updates,
            )

    missing = sum(value is None for value, _etf_id, _date in updates)
    print(f"backfilled {len(updates)} etf_metrics rows; {missing} remain null")


if __name__ == "__main__":
    main()
