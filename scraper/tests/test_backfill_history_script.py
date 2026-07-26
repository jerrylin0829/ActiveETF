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
    rebuilt = {}

    def fake_rebuild(etf_id, build):
        changes = build(snapshots)
        rebuilt.update({"etf_id": etf_id, "changes": changes})
        return len(changes)

    monkeypatch.setattr(
        backfill_history.db,
        "rebuild_changes_from_snapshot_history",
        fake_rebuild,
    )

    backfill_history.rebuild_holding_changes(["00981A"])

    assert rebuilt["etf_id"] == "00981A"
    assert [
        (date, change.change_type)
        for date, change in rebuilt["changes"]
    ] == [
        (dates[1], "ADD"),
        (dates[2], "TRIM"),
        (dates[4], "EXIT"),
    ]


def test_main_logs_validation_failure_without_writing_snapshot(monkeypatch):
    trade_date = dt.date(2026, 6, 15)
    entry = SimpleNamespace(
        etf_id="00981A",
        adapter="uni",
        universe="tw",
    )
    module = SimpleNamespace(
        fetch_at=lambda *_args: [Holding("2330", 1000, 5.0)]
    )
    writes = []
    logs = []

    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _entries: ({"00981A": (entry, module)}, []),
    )
    monkeypatch.setattr(backfill_history, "_today", lambda: trade_date)
    monkeypatch.setattr(
        backfill_history.db,
        "etf_listing_dates",
        lambda _ids: {"00981A": trade_date},
    )
    monkeypatch.setattr(
        backfill_history.db,
        "benchmark_trading_dates",
        lambda _start, _end: [trade_date],
    )
    monkeypatch.setattr(
        backfill_history.db,
        "existing_snapshot_keys",
        lambda _ids: set(),
    )
    monkeypatch.setattr(
        backfill_history.db,
        "known_stock_ids",
        lambda: {"2330"},
    )
    monkeypatch.setattr(
        backfill_history.db,
        "latest_snapshot_date",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        backfill_history.db,
        "write_snapshot",
        lambda *args: writes.append(args),
    )
    monkeypatch.setattr(
        backfill_history.db,
        "log_scrape",
        lambda *args: logs.append(args),
    )
    monkeypatch.setattr(
        backfill_history,
        "rebuild_holding_changes",
        lambda _etf_ids: None,
    )

    backfill_history.main()

    assert writes == []
    assert logs[0][:3] == ("00981A", trade_date, "fail")
    assert "ValidationError" in logs[0][3]


def test_main_reports_skips_and_failure_categories_without_relaxing_validation(
    monkeypatch,
    capsys,
):
    dates = [dt.date(2025, 12, day) for day in range(15, 19)]
    entry = SimpleNamespace(
        etf_id="00990A",
        adapter="yuanta",
        universe="global",
    )

    def fetch_at(_entry, trade_date):
        if trade_date == dates[0]:
            return [Holding("NVDA US", 1000, 50.8)]
        if trade_date == dates[1]:
            raise RuntimeError("upstream unavailable")
        return [Holding("NVDA US", 1000, 80.0)]

    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _entries: (
            {"00990A": (entry, SimpleNamespace(fetch_at=fetch_at))},
            [],
        ),
    )
    monkeypatch.setattr(backfill_history, "_today", lambda: dates[-1])
    monkeypatch.setattr(
        backfill_history.db,
        "etf_listing_dates",
        lambda _ids: {"00990A": dates[0]},
    )
    monkeypatch.setattr(
        backfill_history.db,
        "benchmark_trading_dates",
        lambda _start, _end: dates,
    )
    monkeypatch.setattr(
        backfill_history.db,
        "existing_snapshot_keys",
        lambda _ids: {("00990A", dates[-1])},
    )
    monkeypatch.setattr(backfill_history.db, "known_stock_ids", lambda: set())
    monkeypatch.setattr(
        backfill_history.db,
        "latest_snapshot_date",
        lambda *_args, **_kwargs: None,
    )
    writes = []
    logs = []
    monkeypatch.setattr(
        backfill_history.db,
        "write_snapshot",
        lambda *args: writes.append(args),
    )
    monkeypatch.setattr(
        backfill_history.db,
        "log_scrape",
        lambda *args: logs.append(args),
    )
    monkeypatch.setattr(
        backfill_history,
        "rebuild_holding_changes",
        lambda _etf_ids: None,
    )
    monkeypatch.setattr(backfill_history.time, "sleep", lambda _seconds: None)

    backfill_history.main()

    assert [(etf_id, trade_date) for etf_id, trade_date, _ in writes] == [
        ("00990A", dates[2]),
    ]
    assert [log[2] for log in logs] == ["fail", "fail", "ok"]
    assert "ValidationError" in logs[0][3]
    assert "RuntimeError" in logs[1][3]
    assert (
        "成功 1、已有快照跳過 1、驗證失敗 1、抓取失敗 1"
        in capsys.readouterr().out
    )
