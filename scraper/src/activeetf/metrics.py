"""Metric calculations (spec §6).

Pure functions accept {date: adj_close} dictionaries. compute_all assembles
database and FinMind data, then writes etf_metrics.
"""
import datetime as dt

from activeetf import db, finmind

Series = dict[dt.date, float]


def _at_or_before(s: Series, d: dt.date) -> tuple[dt.date, float] | None:
    ds = [x for x in s if x <= d]
    if not ds:
        return None
    k = max(ds)
    return k, s[k]


def trailing_return(s: Series, asof: dt.date, months: int) -> float | None:
    """Return trailing N-month return; None when history is insufficient."""
    end = _at_or_before(s, asof)
    if end is None:
        return None
    dates = sorted(d for d in s if d <= end[0])
    required_points = months * 30
    if len(dates) < required_points:
        return None
    start_price = s[dates[-required_points]]
    if start_price == 0:
        return None
    return end[1] / start_price - 1.0


def inception_return(s: Series, asof: dt.date) -> float | None:
    end = _at_or_before(s, asof)
    if end is None or not s:
        return None
    first = s[min(s)]
    return end[1] / first - 1.0 if first else None


def _month_ends(s: Series) -> list[dt.date]:
    by_month: dict[tuple[int, int], dt.date] = {}
    for d in s:
        key = (d.year, d.month)
        by_month[key] = max(d, by_month.get(key, d))
    return sorted(by_month.values())[:-1]


def timing_win_rate(etf: Series, bench: Series) -> tuple[int, int]:
    """Return (winning complete months, compared complete months) vs 0050."""
    bench_month_ends = _month_ends(bench)
    ends = [
        d
        for d in _month_ends(etf)
        if d in bench_month_ends or _at_or_before(bench, d)
    ]
    wins = months = 0
    for prev, cur in zip(ends, ends[1:]):
        e0, e1 = _at_or_before(etf, prev), _at_or_before(etf, cur)
        b0, b1 = _at_or_before(bench, prev), _at_or_before(bench, cur)
        if None in (e0, e1, b0, b1):
            continue
        months += 1
        if e1[1] / e0[1] > b1[1] / b0[1]:
            wins += 1
    return wins, months


def load_adj_series(stock_id: str, start: dt.date, end: dt.date) -> Series:
    """Load cached adjusted closes, fetching and caching stale/missing data."""
    with db.conn() as c:
        rows = c.execute(
            """select trade_date, adj_close from stock_price
               where stock_id=%s and trade_date between %s and %s
               and adj_close is not null""",
            (stock_id, start, end),
        ).fetchall()
    s = {r[0]: float(r[1]) for r in rows}
    if not s or max(s) < end - dt.timedelta(days=3):
        fetched = finmind.adj_prices(stock_id, str(start), str(end))
        db.upsert_prices(
            [(r["stock_id"], r["date"], None, r.get("close")) for r in fetched]
        )
        for r in fetched:
            s[dt.date.fromisoformat(r["date"])] = float(r["close"])
    return s


def load_tri_series(start: dt.date, end: dt.date) -> Series:
    with db.conn() as c:
        rows = c.execute(
            """select trade_date, adj_close from stock_price
               where stock_id=%s and trade_date between %s and %s""",
            (finmind.TAIEX_TRI, start, end),
        ).fetchall()
    s = {r[0]: float(r[1]) for r in rows}
    if not s or max(s) < end - dt.timedelta(days=3):
        fetched = finmind.total_return_index(str(start), str(end))
        db.upsert_prices(
            [(finmind.TAIEX_TRI, r["date"], None, r["price"]) for r in fetched]
        )
        for r in fetched:
            s[dt.date.fromisoformat(r["date"])] = float(r["price"])
    return s


def compute_all(today: dt.date) -> None:
    """Compute returns, timing win rate, picking win rate, and style metrics."""
    from activeetf.registry import entries

    start = dt.date(2025, 5, 1)
    bench_0050 = load_adj_series("0050", start, today)
    tri = load_tri_series(start, today)
    for e in entries():
        etf_s = load_adj_series(e.etf_id, start, today)
        if not etf_s:
            continue
        wins, months = timing_win_rate(etf_s, bench_0050)
        pick = picking_win_rate(e.etf_id, today, tri)
        style = style_metrics(e.etf_id, today)
        row = {
            "ret_1m": trailing_return(etf_s, today, 1),
            "ret_3m": trailing_return(etf_s, today, 3),
            "ret_6m": trailing_return(etf_s, today, 6),
            "ret_1y": trailing_return(etf_s, today, 12),
            "ret_inception": inception_return(etf_s, today),
            "bench_0050_1m": trailing_return(bench_0050, today, 1),
            "bench_0050_3m": trailing_return(bench_0050, today, 3),
            "bench_0050_6m": trailing_return(bench_0050, today, 6),
            "bench_0050_1y": trailing_return(bench_0050, today, 12),
            "timing_wins": wins,
            "timing_months": months,
            **pick,
            **style,
        }
        _write_metrics(e.etf_id, today, row)


def _write_metrics(etf_id: str, d: dt.date, row: dict) -> None:
    cols = ", ".join(row)
    ph = ", ".join(["%s"] * len(row))
    sets = ", ".join(f"{k}=excluded.{k}" for k in row)
    with db.conn() as c:
        c.execute(
            f"""insert into etf_metrics (etf_id, trade_date, {cols})
                values (%s, %s, {ph})
                on conflict (etf_id, trade_date) do update set {sets}""",
            (etf_id, d, *row.values()),
        )


def picking_win_rate(etf_id: str, today: dt.date, tri: Series) -> dict:
    """Task 14 placeholder."""
    return {}


def style_metrics(etf_id: str, today: dt.date) -> dict:
    """Task 14 placeholder."""
    return {}
