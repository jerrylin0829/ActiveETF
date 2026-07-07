import datetime as dt

from scripts import backfill


class Entry:
    def __init__(self, etf_id: str):
        self.etf_id = etf_id


def test_backfill_upserts_etfs_0050_and_tri(monkeypatch):
    calls = []

    monkeypatch.setattr(backfill, "entries", lambda: [Entry("00992A")])
    monkeypatch.setattr(backfill.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(
        backfill.finmind,
        "adj_prices",
        lambda sid, start, end: [
            {"stock_id": sid, "date": "2026-07-01", "close": 100.0}
        ],
    )
    monkeypatch.setattr(
        backfill.finmind,
        "total_return_index",
        lambda start, end: [{"date": "2026-07-01", "price": 50000.0}],
    )
    monkeypatch.setattr(backfill.db, "upsert_prices", lambda rows: calls.append(rows))

    backfill.main(start="2026-07-01", today=dt.date(2026, 7, 2))

    assert calls == [
        [("00992A", "2026-07-01", None, 100.0)],
        [("0050", "2026-07-01", None, 100.0)],
        [(backfill.finmind.TAIEX_TRI, "2026-07-01", None, 50000.0)],
    ]
