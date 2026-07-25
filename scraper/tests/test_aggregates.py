import datetime as dt
import os
import uuid
from dataclasses import dataclass

import pytest
from activeetf.models import Holding, Change
from activeetf import db, metrics

pytestmark = pytest.mark.skipif(not os.environ.get("SUPABASE_DB_URL"),
                                reason="needs SUPABASE_DB_URL")

@dataclass(frozen=True)
class AggregateIds:
    date: dt.date
    etfs: tuple[str, str, str]
    stocks: tuple[str, str, str]


def _unique_ids() -> AggregateIds:
    run_id = f"{os.getpid():x}{uuid.uuid4().hex[:8]}"
    day_offset = uuid.uuid4().int % 100_000
    return AggregateIds(
        date=dt.date(1700, 1, 1) + dt.timedelta(days=day_offset),
        etfs=tuple(f"_T{suffix}{run_id}" for suffix in ("A", "B", "C")),
        stocks=tuple(f"_T{suffix}{run_id}" for suffix in ("91", "92", "93")),
    )


def _wipe(ids: AggregateIds):
    # Aggregate rows only carry a date, so each run also gets a unique ancient
    # date. Fact and metadata cleanup is scoped to this run's exact IDs.
    with db.conn() as c:
        c.execute("delete from cross_holdings_daily where trade_date = %s", (ids.date,))
        c.execute("delete from industry_weight_daily where trade_date = %s", (ids.date,))
        c.execute("delete from holding_change where etf_id = any(%s)", (list(ids.etfs),))
        c.execute("delete from holdings_snapshot where etf_id = any(%s)", (list(ids.etfs),))
        c.execute("delete from stock_price where stock_id = any(%s)", (list(ids.stocks),))
        c.execute("delete from stock_info where stock_id = any(%s)", (list(ids.stocks),))
        c.execute("delete from etf where etf_id = any(%s)", (list(ids.etfs),))

@pytest.fixture(autouse=True)
def _seed_and_cleanup():
    ids = _unique_ids()
    _wipe(ids)
    etf_a, etf_b, etf_c = ids.etfs
    stock_a, stock_b, stock_c = ids.stocks
    try:
        with db.conn() as c, c.cursor() as cur:
            cur.executemany(
                "insert into etf (etf_id, name, issuer) values (%s,%s,'x')",
                [(etf_a, "a"), (etf_b, "b"), (etf_c, "c")],
            )
            cur.executemany(
                """insert into stock_info (stock_id, name, industry, market)
                   values (%s,%s,%s,'twse')""",
                [
                    (stock_a, "alpha", "水泥工業"),
                    (stock_b, "beta", ""),
                    (stock_c, "gamma", "水泥工業"),
                ],
            )
            cur.execute(
                """insert into stock_price
                   (stock_id, trade_date, close, adj_close)
                   values (%s, %s, 100, 100)""",
                (stock_a, ids.date),
            )
        db.write_snapshot(
            etf_a,
            ids.date,
            [Holding(stock_a, 2000, 10.0), Holding(stock_b, 1000, 5.0)],
        )
        db.write_snapshot(etf_b, ids.date, [Holding(stock_a, 3000, 8.0)])
        db.write_snapshot(
            etf_c,
            ids.date,
            [Holding(stock_a, 1000, 0.0), Holding(stock_c, 1000, 0.0)],
        )
        db.write_changes(etf_a, ids.date, [Change(stock_a, "ADD", 500, 1.0)])
        db.write_changes(etf_b, ids.date, [Change(stock_a, "NEW", 3000, 8.0)])
        yield ids
    finally:
        _wipe(ids)


def test_cross_holdings_aggregation(_seed_and_cleanup):
    ids = _seed_and_cleanup
    stock_a, stock_b, stock_c = ids.stocks
    db.refresh_daily_aggregates(ids.date)
    with db.conn() as c:
        rows = {r[0]: r for r in c.execute(
            """select stock_id, etf_count, total_weight_pct, total_shares,
                      total_value_twd, new_count, add_count, trim_count, exit_count
               from cross_holdings_daily where trade_date=%s""", (ids.date,)).fetchall()}
    a = rows[stock_a]
    assert (a[1], float(a[2]), a[3]) == (2, 18.0, 5000)
    assert float(a[4]) == 500000.0          # 5000 shares * 100
    assert (a[5], a[6], a[7], a[8]) == (1, 1, 0, 0)   # one NEW + one ADD
    b = rows[stock_b]
    assert (b[1], float(b[2]), b[3], b[4]) == (1, 5.0, 1000, None)  # no price -> null value
    assert stock_c not in rows


def test_industry_weight_aggregation(_seed_and_cleanup):
    ids = _seed_and_cleanup
    db.refresh_daily_aggregates(ids.date)
    with db.conn() as c:
        rows = {r[0]: r for r in c.execute(
            """select industry, sum_weight_pct, stock_count, etf_count_total
               from industry_weight_daily where trade_date=%s""", (ids.date,)).fetchall()}
    assert float(rows["水泥工業"][1]) == 18.0
    assert rows["水泥工業"][2] == 1
    assert rows["水泥工業"][3] == 3          # three ETFs had a snapshot that day
    assert float(rows["未分類"][1]) == 5.0   # blank industry falls back to 未分類


def test_daily_price_cache_values_holding_without_event(
    monkeypatch,
    _seed_and_cleanup,
):
    ids = _seed_and_cleanup
    stock_b = ids.stocks[1]

    def fake_adj_prices(stock_id, start, end):
        assert (stock_id, start, end) == (stock_b, str(ids.date), str(ids.date))
        return [
            {
                "stock_id": stock_id,
                "date": str(ids.date),
                "close": 50.0,
                "raw_close": 52.0,
            }
        ]

    monkeypatch.setattr(metrics.finmind, "adj_prices", fake_adj_prices)

    metrics.cache_daily_holding_closes(ids.date)
    db.refresh_daily_aggregates(ids.date)

    with db.conn() as c:
        row = c.execute(
            """select total_value_twd from cross_holdings_daily
               where trade_date=%s and stock_id=%s""",
            (ids.date, stock_b),
        ).fetchone()
    assert float(row[0]) == 52000.0


def test_refresh_is_idempotent(_seed_and_cleanup):
    ids = _seed_and_cleanup
    db.refresh_daily_aggregates(ids.date)
    db.refresh_daily_aggregates(ids.date)   # rerun must not duplicate
    with db.conn() as c:
        n = c.execute("select count(*) from cross_holdings_daily where trade_date=%s",
                      (ids.date,)).fetchone()[0]
    assert n == 2
