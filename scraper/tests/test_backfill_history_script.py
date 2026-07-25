import datetime as dt
from types import SimpleNamespace

from activeetf.models import Holding
from activeetf.registry import entries
from scripts import backfill_history


def test_discovers_only_registry_entries_with_historical_adapters():
    supported, skipped = backfill_history.discover_adapters(entries())

    assert set(supported) == {
        "00400A",
        "00402A",
        "00403A",
        "00406A",
        "00981A",
        "00983A",
        "00984A",
        "00988A",
        "00990A",
        "00993A",
        "00994A",
        "00995A",
    }
    assert len(skipped) == 16


def test_main_builds_targets_from_cached_0050_trading_dates(monkeypatch):
    listing_date = dt.date(2025, 5, 16)
    today = dt.date(2026, 7, 26)
    trading_dates = [listing_date, dt.date(2025, 5, 19)]
    captured = {}
    entry = SimpleNamespace(etf_id="00981A", adapter="uni")
    module = SimpleNamespace(fetch_at=lambda *_args: [])

    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _entries: ({"00981A": (entry, module)}, []),
    )
    monkeypatch.setattr(backfill_history, "_today", lambda: today)
    monkeypatch.setattr(
        backfill_history.db,
        "etf_listing_dates",
        lambda _ids: {"00981A": listing_date},
    )

    def fake_trading_dates(start, end):
        captured["calendar"] = (start, end)
        return trading_dates

    monkeypatch.setattr(
        backfill_history.db,
        "benchmark_trading_dates",
        fake_trading_dates,
    )
    monkeypatch.setattr(
        backfill_history.db,
        "existing_snapshot_keys",
        lambda _ids: set(),
    )

    def fake_targets(received_dates, listing_dates, existing):
        captured["targets"] = (received_dates, listing_dates, existing)
        return []

    monkeypatch.setattr(backfill_history, "backfill_targets", fake_targets)
    monkeypatch.setattr(
        backfill_history,
        "rebuild_holding_changes",
        lambda etf_ids: captured.setdefault("rebuilt", etf_ids),
    )

    backfill_history.main()

    assert captured["calendar"] == (
        listing_date,
        today,
    )
    assert captured["targets"] == (
        trading_dates,
        {"00981A": listing_date},
        set(),
    )
    assert captured["rebuilt"] == ["00981A"]


def test_rebuild_holding_changes_replays_all_snapshot_dates(monkeypatch):
    dates = [dt.date(2026, 6, day) for day in range(1, 6)]
    snapshots = {
        dates[0]: {"2330": Holding("2330", 1000, 1.0)},
        dates[1]: {"2330": Holding("2330", 1200, 1.2)},
        dates[2]: {"2330": Holding("2330", 1, 0.01)},
        dates[3]: {"2330": Holding("2330", 1, 0.0)},
        dates[4]: {},
    }
    written = {}

    monkeypatch.setattr(
        backfill_history.db,
        "snapshot_history",
        lambda etf_id: snapshots,
    )
    monkeypatch.setattr(
        backfill_history.db,
        "replace_changes",
        lambda etf_id, changes: written.update(
            {"etf_id": etf_id, "changes": changes}
        ),
    )

    backfill_history.rebuild_holding_changes(["00981A"])

    assert written["etf_id"] == "00981A"
    assert [
        (date, change.change_type)
        for date, change in written["changes"]
    ] == [
        (dates[1], "ADD"),
        (dates[2], "TRIM"),
        (dates[4], "EXIT"),
    ]
