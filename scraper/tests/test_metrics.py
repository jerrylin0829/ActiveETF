import datetime as dt

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
