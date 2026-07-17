"""Supabase 持久層。唯一碰 SQL 的模組；業務邏輯（validate/diff/metrics）全部與 DB 解耦。"""
import os, datetime as dt
from contextlib import contextmanager
import psycopg
from activeetf.models import Holding, Change


@contextmanager
def conn():
    # prepare_threshold=None: transaction pooler（pgbouncer）不支援 server-side
    # prepared statements，必須關閉，否則 executemany 偶發 DuplicatePreparedStatement
    with psycopg.connect(os.environ["SUPABASE_DB_URL"], autocommit=True,
                         prepare_threshold=None) as c:
        yield c


def sync_etf(entries) -> None:
    """把 registry 的 ETF metadata 冪等同步進 etf 表。holdings_snapshot 等表對 etf
    有外鍵，pipeline 寫入前必須先確保母表存在對應列。registry 為事實來源，每次
    覆蓋 name/issuer/universe/pcf_url。"""
    with conn() as c, c.cursor() as cur:
        cur.executemany(
            """insert into etf (etf_id, name, issuer, universe, pcf_url)
               values (%s,%s,%s,%s,%s) on conflict (etf_id) do update
               set name=excluded.name, issuer=excluded.issuer,
                   universe=excluded.universe, pcf_url=excluded.pcf_url""",
            [(e.etf_id, e.name, e.issuer, e.universe, e.pcf_url) for e in entries])


def write_snapshot(etf_id: str, d: dt.date, holdings: list[Holding]) -> None:
    with conn() as c, c.cursor() as cur:
        cur.executemany(
            """insert into holdings_snapshot (etf_id, trade_date, stock_id, shares, weight_pct)
               values (%s,%s,%s,%s,%s) on conflict do nothing""",
            [(etf_id, d, h.stock_id, h.shares, h.weight_pct) for h in holdings])


def load_snapshot(etf_id: str, d: dt.date) -> dict[str, Holding]:
    with conn() as c:
        rows = c.execute("""select stock_id, shares, weight_pct from holdings_snapshot
                            where etf_id=%s and trade_date=%s""", (etf_id, d)).fetchall()
    return {r[0]: Holding(r[0], int(r[1]), float(r[2])) for r in rows}


def latest_snapshot_date(etf_id: str, before: dt.date) -> dt.date | None:
    with conn() as c:
        row = c.execute("""select max(trade_date) from holdings_snapshot
                           where etf_id=%s and trade_date < %s""", (etf_id, before)).fetchone()
    return row[0]


def snapshot_count(etf_id: str, d: dt.date) -> int | None:
    with conn() as c:
        row = c.execute("""select count(*) from holdings_snapshot
                           where etf_id=%s and trade_date=%s""", (etf_id, d)).fetchone()
    return row[0] or None


def write_changes(etf_id: str, d: dt.date, changes: list[Change]) -> None:
    with conn() as c, c.cursor() as cur:
        cur.executemany(
            """insert into holding_change (etf_id, trade_date, stock_id, change_type,
               shares_delta, weight_delta_pct) values (%s,%s,%s,%s,%s,%s)
               on conflict (etf_id, trade_date, stock_id) do update
               set change_type=excluded.change_type, shares_delta=excluded.shares_delta,
                   weight_delta_pct=excluded.weight_delta_pct""",
            [(etf_id, d, ch.stock_id, ch.change_type, ch.shares_delta, ch.weight_delta_pct)
             for ch in changes])


def upsert_prices(rows: list[tuple]) -> None:
    """rows: (stock_id, trade_date, close, adj_close)"""
    with conn() as c, c.cursor() as cur:
        cur.executemany(
            """insert into stock_price (stock_id, trade_date, close, adj_close)
               values (%s,%s,%s,%s) on conflict (stock_id, trade_date) do update
               set close=coalesce(excluded.close, stock_price.close),
                   adj_close=coalesce(excluded.adj_close, stock_price.adj_close)""", rows)


def upsert_stock_info(rows: list[tuple]) -> None:
    """rows: (stock_id, name, industry, market)"""
    with conn() as c, c.cursor() as cur:
        cur.executemany(
            """insert into stock_info (stock_id, name, industry, market)
               values (%s,%s,%s,%s) on conflict (stock_id) do update
               set name=excluded.name, industry=excluded.industry, market=excluded.market""", rows)


def known_stock_ids() -> set[str]:
    with conn() as c:
        return {r[0] for r in c.execute("select stock_id from stock_info").fetchall()}


def missing_holding_close_ids(d: dt.date) -> list[str]:
    """Return Taiwan-listed holdings whose raw close is still missing for d."""
    with conn() as c:
        rows = c.execute(
            """select distinct h.stock_id
               from holdings_snapshot h
               join stock_info si on si.stock_id = h.stock_id
               left join stock_price p
                 on p.stock_id = h.stock_id and p.trade_date = h.trade_date
               where h.trade_date = %s and p.close is null
               order by h.stock_id""",
            (d,),
        ).fetchall()
    return [r[0] for r in rows]


def log_scrape(etf_id: str, d: dt.date, status: str, error: str | None = None) -> None:
    with conn() as c:
        c.execute("insert into scrape_log (etf_id, trade_date, status, error) values (%s,%s,%s,%s)",
                  (etf_id, d, status, error))


def scraped_ok(etf_id: str, d: dt.date) -> bool:
    with conn() as c:
        row = c.execute("""select 1 from scrape_log where etf_id=%s and trade_date=%s
                           and status='ok' limit 1""", (etf_id, d)).fetchone()
    return row is not None


def snapshot_trading_dates(upto: dt.date) -> list[dt.date]:
    """Trading-day sequence = distinct snapshot dates (same convention as slice 2)."""
    with conn() as c:
        rows = c.execute("""select distinct trade_date from holdings_snapshot
                            where trade_date <= %s order by 1""", (upto,)).fetchall()
    return [r[0] for r in rows]


def new_exit_events(etf_id: str) -> list[tuple]:
    """(trade_date, stock_id, change_type) NEW/EXIT only — radar rounds must not
    treat big ADDs as entries (that rule belongs to picking-score rounds)."""
    with conn() as c:
        return [tuple(r) for r in c.execute(
            """select trade_date, stock_id, change_type from holding_change
               where etf_id=%s and change_type in ('NEW','EXIT')
               order by trade_date""", (etf_id,)).fetchall()]


def replace_open_positions(etf_ids: list[str], rows: list[tuple]) -> None:
    """rows: (etf_id, stock_id, entry_date, as_of_date, holding_days,
    stock_return_pct, bench_return_pct, excess_return_pct). Scoped delete keeps
    the rebuild idempotent per ETF and lets tests touch only fake ETFs."""
    with conn() as c, c.transaction():
        c.execute("delete from open_position where etf_id = any(%s)", (etf_ids,))
        with c.cursor() as cur:
            cur.executemany(
                """insert into open_position (etf_id, stock_id, entry_date, as_of_date,
                   holding_days, stock_return_pct, bench_return_pct, excess_return_pct)
                   values (%s,%s,%s,%s,%s,%s,%s,%s)""", rows)


def refresh_daily_aggregates(d: dt.date) -> None:
    """Recompute cross_holdings_daily and industry_weight_daily for one date.
    delete + insert…select inside one transaction => idempotent rerun."""
    with conn() as c, c.transaction():
        c.execute("delete from cross_holdings_daily where trade_date=%s", (d,))
        # sum(shares * close): price is per (stock, date) so it is identical on every
        # joined row; if it is missing the whole sum collapses to null (wanted).
        c.execute("""
            insert into cross_holdings_daily
              (trade_date, stock_id, etf_count, total_weight_pct, total_shares,
               total_value_twd, new_count, add_count, trim_count, exit_count)
            select h.trade_date, h.stock_id, count(*), sum(h.weight_pct), sum(h.shares),
                   sum(h.shares * p.close),
                   coalesce(max(c1.new_count), 0), coalesce(max(c1.add_count), 0),
                   coalesce(max(c1.trim_count), 0), coalesce(max(c1.exit_count), 0)
            from holdings_snapshot h
            left join stock_price p
              on p.stock_id = h.stock_id and p.trade_date = h.trade_date
            left join (
              select stock_id,
                     count(*) filter (where change_type='NEW')  as new_count,
                     count(*) filter (where change_type='ADD')  as add_count,
                     count(*) filter (where change_type='TRIM') as trim_count,
                     count(*) filter (where change_type='EXIT') as exit_count
              from holding_change where trade_date = %s
              group by stock_id
            ) c1 on c1.stock_id = h.stock_id
            where h.trade_date = %s
            group by h.trade_date, h.stock_id""", (d, d))
        c.execute("delete from industry_weight_daily where trade_date=%s", (d,))
        c.execute("""
            insert into industry_weight_daily
              (trade_date, industry, sum_weight_pct, stock_count, etf_count_total)
            select h.trade_date,
                   coalesce(nullif(trim(si.industry), ''), '未分類'),
                   sum(h.weight_pct), count(distinct h.stock_id),
                   (select count(distinct etf_id) from holdings_snapshot
                     where trade_date = %s)
            from holdings_snapshot h
            left join stock_info si on si.stock_id = h.stock_id
            where h.trade_date = %s
            group by h.trade_date, coalesce(nullif(trim(si.industry), ''), '未分類')""",
            (d, d))
