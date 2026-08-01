import datetime as dt

import pytest
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
    monkeypatch.setattr(backfill_history.db, "known_stock_ids", lambda: set())

    backfill_history.main([])

    # 日曆兩端各留一段，位移換算才有相鄰交易日可用
    start, end = captured["calendar"]
    assert start < listing_date and end > today
    assert captured["targets"] == (
        trading_dates,
        {"00981A": listing_date},
        set(),
    )
    # 兩階段後預設不重建（需明確 --rebuild-changes）
    assert "rebuilt" not in captured


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
        # 資料日對得上，擋下來的是權重總和那一道
        fetch_at=lambda _entry, date: ([Holding("2330", 1000, 5.0)], date)
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

    backfill_history.main([])

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
            return [Holding("NVDA US", 1000, 50.8)], trade_date
        if trade_date == dates[1]:
            raise RuntimeError("upstream unavailable")
        return [Holding("NVDA US", 1000, 80.0)], trade_date

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

    backfill_history.main([])

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


def test_canary_mode_limits_one_etf_and_date_without_rebuilding_history(
    monkeypatch,
    capsys,
):
    trade_date = dt.date(2025, 12, 15)
    entry = SimpleNamespace(
        etf_id="00990A",
        adapter="yuanta",
        universe="global",
    )
    fetched = []
    rebuilt = []
    writes = []
    logs = []

    def fetch_at(_entry, date):
        fetched.append(date)
        return [Holding("NVDA US", 1000, 80.0)], date

    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _entries: (
            {"00990A": (entry, SimpleNamespace(fetch_at=fetch_at))},
            [],
        ),
    )
    monkeypatch.setattr(backfill_history, "_today", lambda: trade_date)
    monkeypatch.setattr(
        backfill_history.db,
        "etf_listing_dates",
        lambda _ids: {"00990A": trade_date},
    )
    monkeypatch.setattr(
        backfill_history.db,
        "benchmark_trading_dates",
        lambda _start, _end: [trade_date],
    )
    monkeypatch.setattr(backfill_history.db, "existing_snapshot_keys", lambda _ids: set())
    monkeypatch.setattr(backfill_history.db, "known_stock_ids", lambda: set())
    monkeypatch.setattr(
        backfill_history.db,
        "latest_snapshot_date",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        backfill_history.db, "write_snapshot", lambda *args: writes.append(args)
    )
    monkeypatch.setattr(
        backfill_history.db, "log_scrape", lambda *args: logs.append(args)
    )
    monkeypatch.setattr(backfill_history, "rebuild_holding_changes", rebuilt.append)
    monkeypatch.setattr(backfill_history.time, "sleep", lambda _seconds: None)

    backfill_history.main(["--etf-id", "00990A", "--date", "2025-12-15"])

    assert fetched == [trade_date]
    assert rebuilt == []
    # 走的是成功路徑，不是被 tuple 解包例外吃掉
    assert [(etf_id, date) for etf_id, date, _ in writes] == [("00990A", trade_date)]
    assert [log[2] for log in logs] == ["ok"]
    out = capsys.readouterr().out
    assert "Canary：00990A 2025-12-15" in out
    assert "成功 1、已有快照跳過 0、驗證失敗 0、抓取失敗 0" in out


# --- 日期語意 gate（2026-07-31 實測後新增）-------------------------------
# 六支 fetch_at 有四支的請求日不等於資料日。腳本必須（a）依交易日位移換算請求日、
# （b）寫入前核對上游自報的資料日等於目標 trade_date。

def _stub_db(monkeypatch, *, listing, trading_dates, existing=frozenset()):
    writes, logs = [], []
    monkeypatch.setattr(backfill_history, "_today", lambda: max(trading_dates))
    monkeypatch.setattr(
        backfill_history.db, "etf_listing_dates", lambda _ids: listing
    )
    monkeypatch.setattr(
        backfill_history.db,
        "benchmark_trading_dates",
        lambda _start, _end: list(trading_dates),
    )
    monkeypatch.setattr(
        backfill_history.db, "existing_snapshot_keys", lambda _ids: set(existing)
    )
    monkeypatch.setattr(backfill_history.db, "known_stock_ids", lambda: {"2330"})
    monkeypatch.setattr(
        backfill_history.db, "latest_snapshot_date", lambda *_a, **_kw: None
    )
    monkeypatch.setattr(
        backfill_history.db, "write_snapshot", lambda *args: writes.append(args)
    )
    monkeypatch.setattr(
        backfill_history.db, "log_scrape", lambda *args: logs.append(args)
    )
    monkeypatch.setattr(
        backfill_history, "rebuild_holding_changes", lambda _ids: None
    )
    monkeypatch.setattr(backfill_history.time, "sleep", lambda _s: None)
    return writes, logs


def _entry(etf_id="00981A", adapter="uni"):
    return SimpleNamespace(etf_id=etf_id, adapter=adapter, universe="tw")


def _holdings():
    return [Holding("2330", 1000, 90.0)]


# 2026-07-24(五) 與 07-27(一) 之間隔著週末
WEEK = [dt.date(2026, 7, 23), dt.date(2026, 7, 24), dt.date(2026, 7, 27)]


def test_requests_the_offset_shifted_trading_day_not_the_target_date(monkeypatch):
    requested = []

    def fetch_at(_entry, date):
        requested.append(date)
        return _holdings(), dt.date(2026, 7, 24)   # 請求日的前一交易日

    module = SimpleNamespace(fetch_at=fetch_at, HISTORY_REQUEST_OFFSET=1)
    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _e: ({"00981A": (_entry(), module)}, []),
    )
    _stub_db(monkeypatch, listing={"00981A": WEEK[1]}, trading_dates=WEEK)

    backfill_history.main([])

    # 目標 07-24 的請求日是次一「交易日」07-27，不是日曆的 07-25
    assert requested == [dt.date(2026, 7, 27)]


def test_writes_target_date_when_upstream_source_date_matches(monkeypatch):
    module = SimpleNamespace(
        fetch_at=lambda _entry, date: (_holdings(), dt.date(2026, 7, 24)),
        HISTORY_REQUEST_OFFSET=1,
    )
    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _e: ({"00981A": (_entry(), module)}, []),
    )
    writes, logs = _stub_db(
        monkeypatch, listing={"00981A": WEEK[1]}, trading_dates=WEEK
    )

    backfill_history.main([])

    assert [(etf_id, date) for etf_id, date, _ in writes] == [
        ("00981A", dt.date(2026, 7, 24))
    ]
    assert logs[0][2] == "ok"


def test_refuses_to_write_when_upstream_returns_another_days_holdings(monkeypatch):
    module = SimpleNamespace(
        fetch_at=lambda _entry, date: (_holdings(), dt.date(2026, 7, 23)),
        HISTORY_REQUEST_OFFSET=1,
    )
    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _e: ({"00981A": (_entry(), module)}, []),
    )
    writes, logs = _stub_db(
        monkeypatch, listing={"00981A": WEEK[1]}, trading_dates=WEEK
    )

    with pytest.raises(SystemExit):
        backfill_history.main([])

    assert writes == []
    assert logs[0][:3] == ("00981A", dt.date(2026, 7, 24), "fail")
    assert "SourceDateMismatch" in logs[0][3]


def test_date_gate_holds_even_when_adjacent_days_have_identical_holdings(
    monkeypatch,
):
    """連續兩日持股完全相同時，內容比對無鑑別力——只有資料日能擋住錯位。"""
    module = SimpleNamespace(
        # 不論請求哪一天都回同一份持股，且資料日永遠慢一個交易日
        fetch_at=lambda _entry, date: (_holdings(), dt.date(2026, 7, 23)),
        HISTORY_REQUEST_OFFSET=0,
    )
    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _e: ({"00981A": (_entry(), module)}, []),
    )
    writes, logs = _stub_db(
        monkeypatch, listing={"00981A": WEEK[0]}, trading_dates=WEEK
    )

    with pytest.raises(SystemExit):
        backfill_history.main([])

    # 只有 07-23 這天的資料日對得上，其餘兩天必須被擋下
    assert [date for _, date, _ in writes] == [dt.date(2026, 7, 23)]
    assert [log[2] for log in logs] == ["ok", "fail", "fail"]


def test_missing_source_date_is_refused_rather_than_trusted(monkeypatch):
    module = SimpleNamespace(
        fetch_at=lambda _entry, date: (_holdings(), None),
        HISTORY_REQUEST_OFFSET=0,
    )
    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _e: ({"00981A": (_entry(), module)}, []),
    )
    writes, logs = _stub_db(
        monkeypatch, listing={"00981A": WEEK[2]}, trading_dates=WEEK
    )

    with pytest.raises(SystemExit):
        backfill_history.main([])

    assert writes == []
    assert logs[0][2] == "fail"


def test_skips_target_whose_request_date_falls_outside_the_trading_calendar(
    monkeypatch,
):
    fetched = []

    def fetch_at(_entry, date):
        fetched.append(date)
        return _holdings(), date

    module = SimpleNamespace(fetch_at=fetch_at, HISTORY_REQUEST_OFFSET=1)
    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _e: ({"00981A": (_entry(), module)}, []),
    )
    writes, logs = _stub_db(
        monkeypatch, listing={"00981A": WEEK[2]}, trading_dates=WEEK
    )

    backfill_history.main([])

    # 目標 07-27 是日曆最後一天，位移後沒有請求日可用——不得猜一個日期送出
    assert fetched == []
    assert writes == []
    assert logs[0][:3] == ("00981A", dt.date(2026, 7, 27), "fail")


def test_canary_widens_the_calendar_window_so_the_offset_has_neighbours(
    monkeypatch,
):
    captured = {}
    requested = []

    def fetch_at(_entry, date):
        requested.append(date)
        return _holdings(), dt.date(2026, 7, 24)

    module = SimpleNamespace(fetch_at=fetch_at, HISTORY_REQUEST_OFFSET=1)
    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _e: ({"00981A": (_entry(), module)}, []),
    )
    _stub_db(monkeypatch, listing={"00981A": WEEK[0]}, trading_dates=WEEK)

    def fake_trading_dates(start, end):
        captured["window"] = (start, end)
        return WEEK

    monkeypatch.setattr(
        backfill_history.db, "benchmark_trading_dates", fake_trading_dates
    )

    backfill_history.main(["--etf-id", "00981A", "--date", "2026-07-24"])

    assert captured["window"][0] < dt.date(2026, 7, 24) < captured["window"][1]
    assert requested == [dt.date(2026, 7, 27)]


# --- 回補與事件重建拆成兩階段（Evaluator P1-2）-----------------------------
# 日期語意失敗時不得逕自重建 holding_change，否則「先回報再決定」形同虛設。

def test_backfill_does_not_rebuild_changes_by_default(monkeypatch, capsys):
    rebuilt = []
    module = SimpleNamespace(
        fetch_at=lambda _entry, date: (_holdings(), date),
        HISTORY_REQUEST_OFFSET=0,
    )
    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _e: ({"00981A": (_entry(), module)}, []),
    )
    writes, _ = _stub_db(
        monkeypatch, listing={"00981A": WEEK[0]}, trading_dates=WEEK
    )
    monkeypatch.setattr(backfill_history, "rebuild_holding_changes", rebuilt.append)

    backfill_history.main([])

    assert writes and rebuilt == []
    assert "--rebuild-changes" in capsys.readouterr().out


def test_rebuild_changes_flag_rebuilds_without_fetching_anything(monkeypatch):
    fetched, rebuilt = [], []

    def fetch_at(_entry, date):
        fetched.append(date)
        return _holdings(), date

    module = SimpleNamespace(fetch_at=fetch_at, HISTORY_REQUEST_OFFSET=0)
    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _e: ({"00981A": (_entry(), module)}, []),
    )
    writes, _ = _stub_db(
        monkeypatch, listing={"00981A": WEEK[0]}, trading_dates=WEEK
    )
    monkeypatch.setattr(backfill_history, "rebuild_holding_changes", rebuilt.append)

    backfill_history.main(["--rebuild-changes"])

    assert fetched == []
    assert writes == []
    assert rebuilt == [["00981A"]]


def test_any_source_date_mismatch_exits_non_zero(monkeypatch):
    module = SimpleNamespace(
        fetch_at=lambda _entry, date: (_holdings(), WEEK[0]),
        HISTORY_REQUEST_OFFSET=0,
    )
    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _e: ({"00981A": (_entry(), module)}, []),
    )
    _stub_db(monkeypatch, listing={"00981A": WEEK[0]}, trading_dates=WEEK)

    with pytest.raises(SystemExit) as ex:
        backfill_history.main([])

    assert ex.value.code != 0


def test_ordinary_validation_failure_still_exits_zero(monkeypatch):
    """00990A 2025-12-15 的 50.80% 屬已知且可接受的驗證失敗，不該讓整輪失敗。"""
    module = SimpleNamespace(
        fetch_at=lambda _entry, date: ([Holding("2330", 1000, 50.8)], date),
        HISTORY_REQUEST_OFFSET=0,
    )
    monkeypatch.setattr(
        backfill_history,
        "discover_adapters",
        lambda _e: ({"00981A": (_entry(), module)}, []),
    )
    writes, logs = _stub_db(
        monkeypatch, listing={"00981A": WEEK[0]}, trading_dates=WEEK
    )

    backfill_history.main([])  # 不得 raise SystemExit

    assert writes == []
    assert all(log[2] == "fail" for log in logs)
