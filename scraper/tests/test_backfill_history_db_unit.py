import datetime as dt
from contextlib import contextmanager

import pytest

from activeetf import db
from activeetf.models import Change, Holding


class Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class Connection:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params):
        self.calls.append((sql, params))
        if "select trade_date, stock_id, shares, weight_pct" in sql:
            return Result(
                [
                    (dt.date(2026, 7, 1), "2330", 1000, 5.0),
                    (dt.date(2026, 7, 2), "2330", 1100, 5.2),
                ]
            )
        if "from holdings_snapshot" in sql:
            return Result([("00981A", dt.date(2026, 7, 1))])
        if "group by stock_id" in sql:
            return Result([("00981A", dt.date(2025, 5, 16))])
        return Result(
            [
                (dt.date(2025, 5, 16),),
                (dt.date(2025, 5, 19),),
            ]
        )


def fake_connection(connection):
    @contextmanager
    def _conn():
        yield connection

    return _conn


def test_existing_snapshot_keys_returns_written_pairs(monkeypatch):
    connection = Connection()
    monkeypatch.setattr(db, "conn", fake_connection(connection))

    keys = db.existing_snapshot_keys(["00981A"])

    assert keys == {("00981A", dt.date(2026, 7, 1))}
    assert connection.calls[0][1] == (["00981A"],)


def test_etf_listing_dates_uses_earliest_adjusted_price(monkeypatch):
    connection = Connection()
    monkeypatch.setattr(db, "conn", fake_connection(connection))

    listing = db.etf_listing_dates(["00981A"])

    assert listing == {"00981A": dt.date(2025, 5, 16)}
    assert connection.calls[0][1] == (["00981A"],)
    assert "'Infinity'::numeric" in connection.calls[0][0]
    assert "'-Infinity'::numeric" in connection.calls[0][0]


def test_benchmark_trading_dates_uses_price_cache_window(monkeypatch):
    connection = Connection()
    monkeypatch.setattr(db, "conn", fake_connection(connection))
    start = dt.date(2025, 5, 16)
    end = dt.date(2026, 7, 24)

    dates = db.benchmark_trading_dates(start, end)

    assert dates == [dt.date(2025, 5, 16), dt.date(2025, 5, 19)]
    assert connection.calls[0][1] == ("0050", start, end)
    assert "'Infinity'::numeric" in connection.calls[0][0]
    assert "'-Infinity'::numeric" in connection.calls[0][0]


def test_rebuild_changes_locks_reads_and_replaces_in_one_transaction(
    monkeypatch,
):
    operations = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def executemany(self, sql, rows):
            operations.append(("insert", sql, list(rows)))

    class WriteConnection:
        def transaction(self):
            return self

        def cursor(self):
            return Cursor()

        def __enter__(self):
            operations.append(("begin",))
            return self

        def __exit__(self, *_args):
            operations.append(("commit",))

        def execute(self, sql, params=None):
            normalized = " ".join(sql.split())
            if "select trade_date, stock_id, shares, weight_pct" in normalized:
                operations.append(("select", normalized, params))
                return Result(
                    [
                        (dt.date(2026, 7, 1), "2330", 1000, 5.0),
                        (dt.date(2026, 7, 2), "2330", 1100, 5.2),
                    ]
                )
            operation = "lock" if normalized.startswith("lock table") else "delete"
            operations.append((operation, normalized, params))

    monkeypatch.setattr(db, "conn", fake_connection(WriteConnection()))
    date = dt.date(2026, 7, 2)
    change = Change("2330", "ADD", 100, 0.2)
    received = {}

    def build(history):
        received["history"] = history
        return [(date, change)]

    count = db.rebuild_changes_from_snapshot_history("00981A", build)

    assert count == 1
    assert received["history"] == {
        dt.date(2026, 7, 1): {
            "2330": Holding("2330", 1000, 5.0),
        },
        dt.date(2026, 7, 2): {
            "2330": Holding("2330", 1100, 5.2),
        },
    }
    assert operations[0] == ("begin",)
    assert operations[1][0:2] == (
        "lock",
        "lock table holdings_snapshot in share mode",
    )
    assert operations[2][0:2] == (
        "lock",
        "lock table holding_change in share row exclusive mode",
    )
    assert operations[3][0] == "select"
    assert operations[4][0] == "delete"
    assert operations[4][2] == ("00981A",)
    assert operations[5][0] == "insert"
    assert operations[5][2] == [
        ("00981A", date, "2330", "ADD", 100, 0.2),
    ]
    assert operations[6] == ("commit",)


def test_rebuild_changes_rolls_back_when_insert_fails(monkeypatch):
    operations = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def executemany(self, _sql, _rows):
            operations.append(("insert",))
            raise RuntimeError("insert failed")

    class Transaction:
        def __enter__(self):
            operations.append(("begin",))
            return self

        def __exit__(self, exc_type, *_args):
            operations.append(("rollback" if exc_type else "commit",))

    class WriteConnection:
        def transaction(self):
            return Transaction()

        def cursor(self):
            return Cursor()

        def execute(self, sql, _params=None):
            normalized = " ".join(sql.split())
            if "select trade_date, stock_id, shares, weight_pct" in normalized:
                return Result(
                    [(dt.date(2026, 7, 1), "2330", 1000, 5.0)]
                )
            return Result([])

    monkeypatch.setattr(db, "conn", fake_connection(WriteConnection()))

    with pytest.raises(RuntimeError, match="insert failed"):
        db.rebuild_changes_from_snapshot_history(
            "00981A",
            lambda _history: [
                (
                    dt.date(2026, 7, 2),
                    Change("2330", "ADD", 100, 0.2),
                )
            ],
        )

    assert operations == [("begin",), ("insert",), ("rollback",)]
