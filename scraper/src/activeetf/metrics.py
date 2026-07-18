"""Metric calculations (spec §6).

Pure functions accept {date: adj_close} dictionaries. compute_all assembles
database and FinMind data, then writes etf_metrics.
"""
import datetime as dt
from dataclasses import dataclass

from activeetf import db, finmind

Series = dict[dt.date, float]
MIN_OPEN_SCORING_DAYS = 5
ADD_EVENT_MIN_SHARE_GROWTH = 0.10


@dataclass(frozen=True)
class Round:
    stock_id: str
    entry: dt.date
    exit: dt.date | None


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


def load_adj_series(
    stock_id: str,
    start: dt.date,
    end: dt.date,
    *,
    force_fetch: bool = False,
) -> Series:
    """Load cached adjusted closes, fetching and caching stale/missing data."""
    with db.conn() as c:
        rows = c.execute(
            """select trade_date, adj_close from stock_price
               where stock_id=%s and trade_date between %s and %s
               and adj_close is not null""",
            (stock_id, start, end),
        ).fetchall()
    s = {r[0]: float(r[1]) for r in rows}
    # compute_all 只在交易日收盤後跑（main 有 is_trading_day 閘），所以 end=today
    # 本身就是交易日；快取缺 today 當日價即視為過期須補抓。用 <end 而非 end-3天，
    # 否則週一會把上週五誤判為新鮮而漏抓當日還原價。
    if force_fetch or not s or max(s) < end:
        fetched = finmind.adj_prices(stock_id, str(start), str(end))
        db.upsert_prices(
            [(r["stock_id"], r["date"], r.get("raw_close"), r.get("close"))
             for r in fetched]
        )
        for r in fetched:
            s[dt.date.fromisoformat(r["date"])] = float(r["close"])
    return s


def load_tri_series(
    start: dt.date,
    end: dt.date,
    *,
    force_fetch: bool = False,
) -> Series:
    with db.conn() as c:
        rows = c.execute(
            """select trade_date, adj_close from stock_price
               where stock_id=%s and trade_date between %s and %s""",
            (finmind.TAIEX_TRI, start, end),
        ).fetchall()
    s = {r[0]: float(r[1]) for r in rows}
    if force_fetch or not s or max(s) < end:
        fetched = finmind.total_return_index(str(start), str(end))
        db.upsert_prices(
            [(finmind.TAIEX_TRI, r["date"], None, r["price"]) for r in fetched]
        )
        for r in fetched:
            s[dt.date.fromisoformat(r["date"])] = float(r["price"])
    return s


def cache_daily_holding_closes(today: dt.date) -> None:
    """Cache today's raw closes for every Taiwan holding that still lacks one."""
    for stock_id in db.missing_holding_close_ids(today):
        fetched = finmind.adj_prices(stock_id, str(today), str(today))
        if fetched:
            db.upsert_prices(
                [
                    (r["stock_id"], r["date"], r.get("raw_close"), r.get("close"))
                    for r in fetched
                ]
            )


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


def refresh_open_positions(today: dt.date, etf_ids: list[str] | None = None) -> None:
    """Rebuild open_position: every open NEW-initiated round with its
    entry->today excess return vs TAIEX_TRI (handoff 2026-07-17).

    Reuses build_rounds by feeding NEW/EXIT events only, so big ADDs never
    spawn radar rounds. Stocks outside stock_info (foreign) or without prices
    keep null returns — visible but honestly unpriceable.
    """
    if etf_ids is None:
        with db.conn() as c:
            etf_ids = [r[0] for r in c.execute("select etf_id from etf").fetchall()]
    dates = db.snapshot_trading_dates(today)
    tw_ids = db.known_stock_ids()
    open_by_etf = {}
    for etf_id in etf_ids:
        events = [(d, sid, typ, 0, 0) for d, sid, typ in db.new_exit_events(etf_id)]
        open_by_etf[etf_id] = [r for r in build_rounds(events)
                               if r.exit is None and r.entry <= today]
    earliest = min((r.entry for rounds in open_by_etf.values() for r in rounds),
                   default=today)
    history_start = dates[0] if dates else earliest
    window_starts = {
        (etf_id, r.stock_id, r.entry): db.latest_common_price_date(
            r.stock_id, finmind.TAIEX_TRI, r.entry
        )
        for etf_id, open_rounds in open_by_etf.items()
        for r in open_rounds
        if r.stock_id in tw_ids
    }
    tri_start = min(
        (common_start or history_start for common_start in window_starts.values()),
        default=earliest,
    )
    tri = load_tri_series(
        tri_start,
        today,
        force_fetch=any(
            common_start != entry
            for (_etf_id, _stock_id, entry), common_start in window_starts.items()
        ),
    )
    rows = []
    for etf_id, open_rounds in open_by_etf.items():
        for r in open_rounds:
            days = len([d for d in dates if r.entry < d <= today])
            sr = br = None
            if r.stock_id in tw_ids:
                common_start = window_starts[(etf_id, r.stock_id, r.entry)]
                s = load_adj_series(
                    r.stock_id,
                    common_start or history_start,
                    today,
                    force_fetch=common_start != r.entry,
                )
                sr, br = _common_window_returns(s, tri, r.entry, today)
            rows.append((etf_id, r.stock_id, r.entry, today, days,
                         None if sr is None else round(sr * 100, 4),
                         None if br is None else round(br * 100, 4),
                         None if sr is None or br is None
                         else round((sr - br) * 100, 4)))
    db.replace_open_positions(etf_ids, rows)


def build_rounds(events: list[tuple]) -> list[Round]:
    """Build scoring rounds from holding changes."""
    entries_, exits = [], {}
    for d, sid, typ, delta, prev_shares in sorted(events):
        if typ == "NEW":
            entries_.append((d, sid))
        elif (
            typ == "ADD"
            and prev_shares
            and delta / prev_shares >= ADD_EVENT_MIN_SHARE_GROWTH
        ):
            entries_.append((d, sid))
        elif typ == "EXIT":
            exits.setdefault(sid, []).append(d)

    rounds = []
    for d, sid in entries_:
        exit_d = min((x for x in exits.get(sid, []) if x > d), default=None)
        rounds.append(Round(sid, d, exit_d))
    return rounds


def _window_return(s: Series, start: dt.date, end: dt.date) -> float | None:
    a, b = _at_or_before(s, start), _at_or_before(s, end)
    if a is None or b is None or a[1] == 0:
        return None
    return b[1] / a[1] - 1.0


def _common_window_returns(
    stock: Series,
    bench: Series,
    start: dt.date,
    end: dt.date,
) -> tuple[float | None, float | None]:
    common_dates = stock.keys() & bench.keys()
    starts = [d for d in common_dates if d <= start]
    ends = [d for d in common_dates if d <= end]
    if not starts or not ends:
        return None, None
    common_start = max(starts)
    common_end = max(ends)
    if common_end < common_start:
        return None, None
    return (
        _window_return(stock, common_start, common_end),
        _window_return(bench, common_start, common_end),
    )


def score_rounds(
    rounds: list[Round],
    stock_series: dict[str, Series],
    tri: Series,
    asof: dt.date,
    min_open_days: int = MIN_OPEN_SCORING_DAYS,
) -> dict:
    realized_w = realized_t = open_w = open_t = 0
    trading_days = sorted(tri)
    for r in rounds:
        s = stock_series.get(r.stock_id)
        if not s:
            continue
        end = r.exit or asof
        if r.exit is None:
            elapsed = len([d for d in trading_days if r.entry < d <= asof])
            if elapsed < min_open_days:
                continue
        sr, br = _window_return(s, r.entry, end), _window_return(tri, r.entry, end)
        if sr is None or br is None:
            continue
        win = sr > br
        if r.exit is not None:
            realized_t += 1
            realized_w += win
        else:
            open_t += 1
            open_w += win
    return {
        "picking_realized_wins": realized_w,
        "picking_realized_total": realized_t,
        "picking_open_wins": open_w,
        "picking_open_total": open_t,
    }


def picking_win_rate(etf_id: str, today: dt.date, tri: Series) -> dict:
    with db.conn() as c:
        events = c.execute(
            """
            select hc.trade_date, hc.stock_id, hc.change_type, hc.shares_delta,
                   coalesce(hs.shares, 0)
            from holding_change hc
            left join holdings_snapshot hs
              on hs.etf_id = hc.etf_id and hs.stock_id = hc.stock_id
             and hs.trade_date = (select max(trade_date) from holdings_snapshot
                                  where etf_id = hc.etf_id and stock_id = hc.stock_id
                                    and trade_date < hc.trade_date)
            where hc.etf_id = %s
            """,
            (etf_id,),
        ).fetchall()
    rounds = build_rounds([tuple(e) for e in events])
    tw_ids = db.known_stock_ids()
    needed = {r.stock_id for r in rounds if r.stock_id in tw_ids}
    start = min((r.entry for r in rounds), default=today)
    series = {sid: load_adj_series(sid, start, today) for sid in needed}
    return score_rounds(rounds, series, tri, today)


def style_metrics(etf_id: str, today: dt.date) -> dict:
    """Median realized holding days and recent weekly turnover."""
    with db.conn() as c:
        rounds = c.execute(
            """
            select n.stock_id, n.trade_date as entry,
                   (select min(trade_date) from holding_change x
                    where x.etf_id = n.etf_id and x.stock_id = n.stock_id
                      and x.change_type = 'EXIT' and x.trade_date > n.trade_date) as exit
            from holding_change n
            where n.etf_id = %s and n.change_type = 'NEW'
            """,
            (etf_id,),
        ).fetchall()
        held = [r for r in rounds if r[2] is not None]
        durations = sorted((r[2] - r[1]).days for r in held)
        recent = c.execute(
            """
            select count(*) from holding_change
            where etf_id = %s and change_type in ('NEW','EXIT')
              and trade_date > %s
            """,
            (etf_id, today - dt.timedelta(days=7)),
        ).fetchone()[0]
        avg_count = c.execute(
            """
            select avg(cnt) from (select count(*) cnt from holdings_snapshot
            where etf_id = %s group by trade_date order by trade_date desc limit 5) t
            """,
            (etf_id,),
        ).fetchone()[0]
    median = durations[len(durations) // 2] if durations else None
    turnover = float(recent) / float(avg_count) * 100 if avg_count else None
    return {"median_holding_days": median, "weekly_turnover_pct": turnover}
