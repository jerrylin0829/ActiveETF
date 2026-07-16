import os, datetime as dt
import pytest
from activeetf.models import Holding, Change
from activeetf import db

pytestmark = pytest.mark.skipif(not os.environ.get("SUPABASE_DB_URL"),
                                reason="needs SUPABASE_DB_URL")

D = dt.date(2000, 1, 4)  # ancient date to avoid touching real data; cleaned up below

def _wipe():
    # fake ids only ('_T*'); never touch real rows. Runs before AND after each
    # test so an interrupted run can't wedge the next one.
    with db.conn() as c:
        for t in ("cross_holdings_daily", "industry_weight_daily",
                  "holding_change", "holdings_snapshot", "stock_price"):
            c.execute(f"delete from {t} where trade_date = %s", (D,))
        c.execute("delete from stock_info where stock_id in ('_T91','_T92')")
        c.execute("delete from etf where etf_id in ('_TA','_TB')")

@pytest.fixture(autouse=True)
def _seed_and_cleanup():
    _wipe()
    with db.conn() as c:
        c.execute("insert into etf (etf_id, name, issuer) values "
                  "('_TA','a','x'), ('_TB','b','x')")
        c.execute("insert into stock_info (stock_id, name, industry, market) values "
                  "('_T91','alpha','水泥工業','twse'), ('_T92','beta','','twse')")
        c.execute("insert into stock_price (stock_id, trade_date, close, adj_close) values "
                  "('_T91', %s, 100, 100)", (D,))  # _T92 has no price on purpose
    db.write_snapshot("_TA", D, [Holding("_T91", 2000, 10.0), Holding("_T92", 1000, 5.0)])
    db.write_snapshot("_TB", D, [Holding("_T91", 3000, 8.0)])
    db.write_changes("_TA", D, [Change("_T91", "ADD", 500, 1.0)])
    db.write_changes("_TB", D, [Change("_T91", "NEW", 3000, 8.0)])
    yield
    _wipe()

def test_cross_holdings_aggregation():
    db.refresh_daily_aggregates(D)
    with db.conn() as c:
        rows = {r[0]: r for r in c.execute(
            """select stock_id, etf_count, total_weight_pct, total_shares,
                      total_value_twd, new_count, add_count, trim_count, exit_count
               from cross_holdings_daily where trade_date=%s""", (D,)).fetchall()}
    a = rows["_T91"]
    assert (a[1], float(a[2]), a[3]) == (2, 18.0, 5000)
    assert float(a[4]) == 500000.0          # 5000 shares * 100
    assert (a[5], a[6], a[7], a[8]) == (1, 1, 0, 0)   # one NEW + one ADD
    b = rows["_T92"]
    assert (b[1], float(b[2]), b[3], b[4]) == (1, 5.0, 1000, None)  # no price -> null value

def test_industry_weight_aggregation():
    db.refresh_daily_aggregates(D)
    with db.conn() as c:
        rows = {r[0]: r for r in c.execute(
            """select industry, sum_weight_pct, stock_count, etf_count_total
               from industry_weight_daily where trade_date=%s""", (D,)).fetchall()}
    assert float(rows["水泥工業"][1]) == 18.0
    assert rows["水泥工業"][2] == 1
    assert rows["水泥工業"][3] == 2          # two ETFs had a snapshot that day
    assert float(rows["未分類"][1]) == 5.0   # blank industry falls back to 未分類

def test_refresh_is_idempotent():
    db.refresh_daily_aggregates(D)
    db.refresh_daily_aggregates(D)   # rerun must not duplicate
    with db.conn() as c:
        n = c.execute("select count(*) from cross_holdings_daily where trade_date=%s",
                      (D,)).fetchone()[0]
    assert n == 2
