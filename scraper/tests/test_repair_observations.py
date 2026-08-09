"""觀察部位缺口修復腳本（Evaluator P1-1：bounded append-only）。"""
import datetime as dt
from types import SimpleNamespace

import pytest

from activeetf.models import Holding
from scripts import repair_observations

WEEK = [dt.date(2026, 7, 21), dt.date(2026, 7, 22), dt.date(2026, 7, 23)]
TARGET = WEEK[1]
_ARGS = ["--etf-id", "00981A", "--from", "2026-07-21", "--to", "2026-07-23"]


def _stub(monkeypatch, *, upstream, existing, offset=0):
    writes, logs = [], []
    entry = SimpleNamespace(etf_id="00981A", adapter="uni", universe="tw")
    module = SimpleNamespace(
        fetch_at=lambda _entry, date: (upstream, date),
        HISTORY_REQUEST_OFFSET=offset,
    )
    monkeypatch.setattr(
        repair_observations,
        "discover_adapters",
        lambda _e: ({"00981A": (entry, module)}, []),
    )
    monkeypatch.setattr(
        repair_observations.db,
        "benchmark_trading_dates",
        lambda _s, _e: list(WEEK),
    )
    monkeypatch.setattr(
        repair_observations.db,
        "existing_snapshot_keys",
        lambda _ids: {("00981A", TARGET)},
    )
    monkeypatch.setattr(
        repair_observations.db,
        "load_snapshot",
        lambda _etf, _d: existing,
    )
    monkeypatch.setattr(
        repair_observations.db,
        "write_snapshot",
        lambda *args: writes.append(args),
    )
    monkeypatch.setattr(
        repair_observations.db, "log_scrape", lambda *args: logs.append(args)
    )
    monkeypatch.setattr(repair_observations.time, "sleep", lambda _s: None)
    return writes, logs


def test_dry_run_reports_without_writing(monkeypatch, capsys):
    writes, _ = _stub(
        monkeypatch,
        upstream=[Holding("2330", 1000, 90.0), Holding("6488", 500, 0.0)],
        existing={"2330": Holding("2330", 1000, 90.0)},
    )

    repair_observations.main(_ARGS)

    assert writes == []
    out = capsys.readouterr().out
    assert "1" in out and "--apply" in out


def test_apply_inserts_only_the_missing_observation_rows(monkeypatch):
    writes, _ = _stub(
        monkeypatch,
        upstream=[
            Holding("2330", 1000, 90.0),
            Holding("6488", 500, 0.0),
            Holding("4904", 300, 0.0),
        ],
        existing={"2330": Holding("2330", 1000, 90.0)},
    )

    repair_observations.main(_ARGS + ["--apply"])

    assert len(writes) == 1
    etf_id, trade_date, rows = writes[0]
    assert (etf_id, trade_date) == ("00981A", TARGET)
    assert sorted(h.stock_id for h in rows) == ["4904", "6488"]
    assert all(h.weight_pct == 0 for h in rows)


def test_apply_refuses_the_date_when_an_existing_row_disagrees(monkeypatch, capsys):
    writes, _ = _stub(
        monkeypatch,
        upstream=[Holding("2330", 1111, 90.0), Holding("6488", 500, 0.0)],
        existing={"2330": Holding("2330", 1000, 90.0)},
    )

    with pytest.raises(SystemExit):
        repair_observations.main(_ARGS + ["--apply"])

    assert writes == []
    assert "2330" in capsys.readouterr().out


def test_apply_refuses_the_date_when_a_missing_row_has_real_weight(
    monkeypatch, capsys
):
    writes, _ = _stub(
        monkeypatch,
        upstream=[Holding("2330", 1000, 90.0), Holding("2317", 800, 3.2)],
        existing={"2330": Holding("2330", 1000, 90.0)},
    )

    with pytest.raises(SystemExit):
        repair_observations.main(_ARGS + ["--apply"])

    assert writes == []
    assert "2317" in capsys.readouterr().out


def test_refuses_the_date_when_upstream_returns_another_days_data(monkeypatch):
    writes, _ = _stub(
        monkeypatch,
        upstream=[Holding("2330", 1000, 90.0), Holding("6488", 500, 0.0)],
        existing={"2330": Holding("2330", 1000, 90.0)},
        offset=1,  # 請求日 07-23，stub 回傳的資料日就是請求日 → 與目標 07-22 不符
    )

    with pytest.raises(SystemExit):
        repair_observations.main(_ARGS + ["--apply"])

    assert writes == []


def test_apply_writes_nothing_when_snapshot_is_already_complete(monkeypatch):
    writes, _ = _stub(
        monkeypatch,
        upstream=[Holding("2330", 1000, 90.0)],
        existing={"2330": Holding("2330", 1000, 90.0)},
    )

    repair_observations.main(_ARGS + ["--apply"])

    assert writes == []


def test_never_deletes_or_updates_existing_rows(monkeypatch):
    """守住 append-only：腳本不得使用 update/delete 這類 DB 入口。"""
    for forbidden in ("rebuild_changes_from_snapshot_history", "replace_open_positions"):
        monkeypatch.setattr(
            repair_observations.db,
            forbidden,
            lambda *a, **kw: pytest.fail(f"repair 不得呼叫 {forbidden}"),
        )
    writes, _ = _stub(
        monkeypatch,
        upstream=[Holding("2330", 1000, 90.0), Holding("6488", 500, 0.0)],
        existing={"2330": Holding("2330", 1000, 90.0)},
    )

    repair_observations.main(_ARGS + ["--apply"])

    assert len(writes) == 1


def test_calendar_query_extends_beyond_the_target_range(monkeypatch):
    """位移需要範圍外的相鄰交易日，日曆視窗必須比目標範圍寬。"""
    captured = {}
    _stub(
        monkeypatch,
        upstream=[Holding("2330", 1000, 90.0)],
        existing={"2330": Holding("2330", 1000, 90.0)},
    )

    def fake_calendar(start, end):
        captured["window"] = (start, end)
        return list(WEEK)

    monkeypatch.setattr(
        repair_observations.db, "benchmark_trading_dates", fake_calendar
    )

    repair_observations.main(_ARGS)

    assert captured["window"][0] < TARGET < captured["window"][1]


# --- Evaluator P1-1 複審：修復必須真的 bounded -----------------------------

def test_refuses_to_run_without_an_explicit_manifest(monkeypatch):
    """不給 ETF 與日期範圍就掃全部 = 回補後多發數千次請求，必須拒絕。"""
    _stub(
        monkeypatch,
        upstream=[Holding("2330", 1000, 90.0)],
        existing={"2330": Holding("2330", 1000, 90.0)},
    )

    with pytest.raises(SystemExit):
        repair_observations.main([])


def test_manifest_limits_targets_to_the_named_etfs(monkeypatch):
    seen = []
    monkeypatch.setattr(
        repair_observations.db,
        "existing_snapshot_keys",
        lambda ids: seen.append(sorted(ids)) or {("00981A", TARGET)},
    )
    _stub(
        monkeypatch,
        upstream=[Holding("2330", 1000, 90.0)],
        existing={"2330": Holding("2330", 1000, 90.0)},
    )
    monkeypatch.setattr(
        repair_observations.db,
        "existing_snapshot_keys",
        lambda ids: seen.append(sorted(ids)) or {("00981A", TARGET)},
    )

    repair_observations.main(_ARGS)

    assert seen[-1] == ["00981A"]


def test_sleeps_after_every_request_including_skipped_ones(monkeypatch):
    """503／日期不符原本直接 continue，會跳過間隔連續打上游。"""
    slept = []
    _stub(
        monkeypatch,
        upstream=[Holding("2330", 1000, 90.0)],
        existing={"2330": Holding("2330", 1000, 90.0)},
    )
    monkeypatch.setattr(
        repair_observations.db,
        "existing_snapshot_keys",
        lambda _ids: {("00981A", WEEK[0]), ("00981A", TARGET)},
    )

    def boom(_entry, _date):
        raise RuntimeError("503 Server Error")

    monkeypatch.setattr(
        repair_observations,
        "discover_adapters",
        lambda _e: (
            {
                "00981A": (
                    SimpleNamespace(etf_id="00981A", adapter="uni", universe="tw"),
                    SimpleNamespace(fetch_at=boom, HISTORY_REQUEST_OFFSET=0),
                )
            },
            [],
        ),
    )
    monkeypatch.setattr(repair_observations.time, "sleep", slept.append)

    with pytest.raises(SystemExit):
        repair_observations.main(_ARGS)

    assert len(slept) == 2  # 兩次請求、兩次間隔，失敗也不例外


def test_any_skipped_date_exits_non_zero(monkeypatch):
    """帶著未修復的缺口去重建事件，等於把假事件固化下來。"""
    _stub(
        monkeypatch,
        upstream=[Holding("2330", 1111, 90.0)],   # 既有列不符 → 跳過
        existing={"2330": Holding("2330", 1000, 90.0)},
    )

    with pytest.raises(SystemExit) as ex:
        repair_observations.main(_ARGS + ["--apply"])

    assert ex.value.code != 0


def test_clean_run_exits_zero(monkeypatch):
    _stub(
        monkeypatch,
        upstream=[Holding("2330", 1000, 90.0), Holding("6488", 500, 0.0)],
        existing={"2330": Holding("2330", 1000, 90.0)},
    )

    repair_observations.main(_ARGS + ["--apply"])  # 不得 raise
