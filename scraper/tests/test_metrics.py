import datetime as dt
from types import SimpleNamespace

import pytest

from activeetf import metrics


def _series(start: str, closes: list[float]) -> dict[dt.date, float]:
    d0 = dt.date.fromisoformat(start)
    out, d = {}, d0
    i = 0
    while i < len(closes):
        if d.weekday() < 5:
            out[d] = closes[i]
            i += 1
        d += dt.timedelta(days=1)
    return out


def test_trailing_return_1m():
    s = _series("2026-05-20", [100 + i * 10 / 29 for i in range(30)])
    last = max(s)
    r = metrics.trailing_return(s, last, months=1)
    assert r is not None and 0.08 < r < 0.12


def test_trailing_return_none_when_history_too_short():
    s = _series("2026-07-01", [100, 101, 102])
    assert metrics.trailing_return(s, max(s), months=12) is None


def test_timing_win_rate():
    etf = _series("2026-01-05", [100 * (1.001 ** i) for i in range(120)])
    bench = _series("2026-01-05", [100 * (1.0005 ** i) for i in range(120)])
    wins, months = metrics.timing_win_rate(etf, bench)
    assert months >= 4 and wins == months


def test_benchmark_inception_return_aligns_to_etf_first_price():
    bench = {
        dt.date(2026, 5, 1): 100.0,
        dt.date(2026, 7, 1): 120.0,
        dt.date(2026, 7, 2): 132.0,
    }
    etf = {
        dt.date(2026, 7, 1): 10.0,
        dt.date(2026, 7, 2): 11.0,
    }

    assert metrics.benchmark_inception_return(
        bench, etf, dt.date(2026, 7, 2)
    ) == pytest.approx(0.1)


def test_compute_all_writes_aligned_benchmark_inception(monkeypatch):
    today = dt.date(2026, 7, 2)
    bench = {
        dt.date(2026, 5, 1): 100.0,
        dt.date(2026, 7, 1): 120.0,
        today: 132.0,
    }
    etf = {
        dt.date(2026, 7, 1): 10.0,
        today: 11.0,
    }
    written = []

    from activeetf import registry

    monkeypatch.setattr(registry, "entries", lambda: [SimpleNamespace(etf_id="00999A")])
    monkeypatch.setattr(
        metrics,
        "load_adj_series",
        lambda stock_id, _start, _end: bench if stock_id == "0050" else etf,
    )
    monkeypatch.setattr(metrics, "load_tri_series", lambda _start, _end: {})
    monkeypatch.setattr(metrics, "timing_win_rate", lambda _etf, _bench: (0, 0))
    monkeypatch.setattr(metrics, "picking_win_rate", lambda _etf_id, _today, _tri: {})
    monkeypatch.setattr(metrics, "style_metrics", lambda _etf_id, _today: {})
    monkeypatch.setattr(
        metrics,
        "_write_metrics",
        lambda etf_id, trade_date, row: written.append((etf_id, trade_date, row)),
    )

    metrics.compute_all(today)

    assert written[0][2]["bench_0050_inception"] == pytest.approx(0.1)
