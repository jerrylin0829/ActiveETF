import datetime as dt
from contextlib import contextmanager

from activeetf import db


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
