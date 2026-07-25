import datetime as dt
from contextlib import contextmanager

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


def test_benchmark_trading_dates_uses_price_cache_window(monkeypatch):
    connection = Connection()
    monkeypatch.setattr(db, "conn", fake_connection(connection))
    start = dt.date(2025, 5, 16)
    end = dt.date(2026, 7, 24)

    dates = db.benchmark_trading_dates(start, end)

    assert dates == [dt.date(2025, 5, 16), dt.date(2025, 5, 19)]
    assert connection.calls[0][1] == ("0050", start, end)


def test_snapshot_history_groups_rows_by_date(monkeypatch):
    connection = Connection()
    monkeypatch.setattr(db, "conn", fake_connection(connection))

    history = db.snapshot_history("00981A")

    assert history == {
        dt.date(2026, 7, 1): {
            "2330": Holding("2330", 1000, 5.0),
        },
        dt.date(2026, 7, 2): {
            "2330": Holding("2330", 1100, 5.2),
        },
    }


def test_replace_changes_deletes_then_inserts_in_one_transaction(monkeypatch):
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

        def execute(self, sql, params):
            operations.append(("delete", sql, params))

    monkeypatch.setattr(db, "conn", fake_connection(WriteConnection()))
    date = dt.date(2026, 7, 2)
    change = Change("2330", "ADD", 100, 0.2)

    db.replace_changes("00981A", [(date, change)])

    assert operations[0] == ("begin",)
    assert operations[1][0] == "delete"
    assert operations[1][2] == ("00981A",)
    assert operations[2][0] == "insert"
    assert operations[2][2] == [
        ("00981A", date, "2330", "ADD", 100, 0.2),
    ]
    assert operations[3] == ("commit",)
