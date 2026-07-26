import datetime as dt
import os
import uuid
from dataclasses import dataclass
from decimal import Decimal

import pytest
from psycopg.errors import CheckViolation, NumericValueOutOfRange

from activeetf import db
from activeetf.models import Change, Holding
from scripts.backfill_history import build_holding_changes

pytestmark = pytest.mark.skipif(
    not os.environ.get("SUPABASE_DB_URL"),
    reason="needs SUPABASE_DB_URL",
)


@dataclass(frozen=True)
class FixtureIds:
    etf_id: str
    holding_id: str
    benchmark_id: str
    dates: tuple[dt.date, dt.date]


def unique_ids() -> FixtureIds:
    run_id = f"{os.getpid():x}{uuid.uuid4().hex[:8]}"
    offset = uuid.uuid4().int % 100_000
    first = dt.date(1700, 1, 1) + dt.timedelta(days=offset)
    return FixtureIds(
        etf_id=f"_THA{run_id}",
        holding_id=f"_TH1{run_id}",
        benchmark_id=f"_THB{run_id}",
        dates=(first, first + dt.timedelta(days=1)),
    )


def wipe(ids: FixtureIds) -> None:
    stock_ids = [ids.etf_id, ids.holding_id, ids.benchmark_id]
    with db.conn() as connection:
        connection.execute(
            "delete from holding_change where etf_id = %s",
            (ids.etf_id,),
        )
        connection.execute(
            "delete from holdings_snapshot where etf_id = %s",
            (ids.etf_id,),
        )
        connection.execute(
            "delete from stock_price where stock_id = any(%s)",
            (stock_ids,),
        )
        connection.execute(
            "delete from stock_info where stock_id = any(%s)",
            (stock_ids,),
        )
        connection.execute("delete from etf where etf_id = %s", (ids.etf_id,))


@pytest.fixture
def seeded_history():
    ids = unique_ids()
    wipe(ids)
    first, second = ids.dates
    try:
        with db.conn() as connection:
            connection.execute(
                "insert into etf (etf_id, name, issuer) values (%s, 'a', 'x')",
                (ids.etf_id,),
            )
            connection.execute(
                """insert into stock_info (stock_id, name, industry, market)
                   values (%s, 'ETF', '基金', 'twse'),
                          (%s, 'alpha', '水泥工業', 'twse'),
                          (%s, 'benchmark', '基金', 'twse')""",
                (ids.etf_id, ids.holding_id, ids.benchmark_id),
            )
            connection.execute(
                """insert into stock_price
                   (stock_id, trade_date, close, adj_close)
                   values (%s, %s, 10, 10),
                          (%s, %s, 11, 11),
                          (%s, %s, 20, 20),
                          (%s, %s, 21, 21)""",
                (
                    ids.etf_id,
                    second,
                    ids.etf_id,
                    first,
                    ids.benchmark_id,
                    first,
                    ids.benchmark_id,
                    second,
                ),
            )
        db.write_snapshot(
            ids.etf_id,
            first,
            [Holding(ids.holding_id, 1000, 5.0)],
        )
        db.write_snapshot(
            ids.etf_id,
            second,
            [Holding(ids.holding_id, 1100, 5.2)],
        )
        yield ids
    finally:
        wipe(ids)


def test_history_db_helpers(seeded_history):
    ids = seeded_history
    first, second = ids.dates

    assert db.existing_snapshot_keys([ids.etf_id]) == {
        (ids.etf_id, first),
        (ids.etf_id, second),
    }
    assert db.etf_listing_dates([ids.etf_id]) == {ids.etf_id: first}
    assert db.benchmark_trading_dates(
        first,
        second,
        benchmark_id=ids.benchmark_id,
    ) == [first, second]


def test_rebuild_changes_from_snapshot_history_integration(seeded_history):
    ids = seeded_history
    _first, second = ids.dates

    count = db.rebuild_changes_from_snapshot_history(
        ids.etf_id,
        build_holding_changes,
    )

    assert count == 1
    with db.conn() as connection:
        rows = connection.execute(
            """select trade_date, stock_id, change_type,
                      shares_delta, weight_delta_pct
               from holding_change
               where etf_id = %s""",
            (ids.etf_id,),
        ).fetchall()
    assert rows == [
        (second, ids.holding_id, "ADD", 100, Decimal("0.2")),
    ]


def test_rebuild_changes_rolls_back_destructive_replace(seeded_history):
    ids = seeded_history
    _first, second = ids.dates
    sentinel = Change(ids.holding_id, "ADD", 100, 0.2)
    db.write_changes(ids.etf_id, second, [sentinel])

    def invalid_changes(_history):
        return [
            (
                second,
                Change(ids.holding_id, "INVALID", 999, 9.99),
            )
        ]

    with pytest.raises(CheckViolation):
        db.rebuild_changes_from_snapshot_history(
            ids.etf_id,
            invalid_changes,
        )

    with db.conn() as connection:
        rows = connection.execute(
            """select trade_date, stock_id, change_type,
                      shares_delta, weight_delta_pct
               from holding_change
               where etf_id = %s""",
            (ids.etf_id,),
        ).fetchall()
    assert rows == [
        (second, ids.holding_id, "ADD", 100, Decimal("0.2")),
    ]


def test_write_snapshot_rolls_back_partial_holdings(seeded_history):
    ids = seeded_history
    target_date = ids.dates[1] + dt.timedelta(days=1)

    with pytest.raises(NumericValueOutOfRange):
        db.write_snapshot(
            ids.etf_id,
            target_date,
            [
                Holding(ids.holding_id, 1000, 5.0),
                Holding(ids.benchmark_id, 500, 100_000.0),
            ],
        )

    with db.conn() as connection:
        count = connection.execute(
            """select count(*) from holdings_snapshot
               where etf_id = %s and trade_date = %s""",
            (ids.etf_id, target_date),
        ).fetchone()[0]
    assert count == 0
