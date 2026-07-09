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


def log_scrape(etf_id: str, d: dt.date, status: str, error: str | None = None) -> None:
    with conn() as c:
        c.execute("insert into scrape_log (etf_id, trade_date, status, error) values (%s,%s,%s,%s)",
                  (etf_id, d, status, error))


def scraped_ok(etf_id: str, d: dt.date) -> bool:
    with conn() as c:
        row = c.execute("""select 1 from scrape_log where etf_id=%s and trade_date=%s
                           and status='ok' limit 1""", (etf_id, d)).fetchone()
    return row is not None
