import os, datetime as dt
import pytest
from activeetf.models import Holding, Change
from activeetf import db, finmind, metrics

pytestmark = pytest.mark.skipif(not os.environ.get("SUPABASE_DB_URL"),
                                reason="needs SUPABASE_DB_URL")

# ancient weekday dates far from real data; cleaned up before and after
D1, D2, D3, D4, D5 = (dt.date(2000, 2, 7), dt.date(2000, 2, 8), dt.date(2000, 2, 9),
                      dt.date(2000, 2, 10), dt.date(2000, 2, 11))
ALL_D = (D1, D2, D3, D4, D5)


def _wipe():
    with db.conn() as c:
        c.execute("delete from open_position where etf_id = '_TC'")
        for t in ("holding_change", "holdings_snapshot", "stock_price"):
            c.execute(f"delete from {t} where trade_date = any(%s)", (list(ALL_D),))
        c.execute("delete from stock_info where stock_id in ('_T91','_T93')")
        c.execute("delete from etf where etf_id = '_TC'")


@pytest.fixture(autouse=True)
def _seed_and_cleanup():
    _wipe()
    with db.conn() as c:
        c.execute("insert into etf (etf_id, name, issuer) values ('_TC','c','x')")
        # _T92 deliberately absent from stock_info => treated like a foreign holding
        c.execute("insert into stock_info (stock_id, name, industry, market) values "
                  "('_T91','alpha','水泥工業','twse'), ('_T93','gamma','水泥工業','twse')")
        c.cursor().executemany(
            "insert into stock_price (stock_id, trade_date, close, adj_close) values (%s,%s,%s,%s)",
            [("_T91", D1, 100, 100), ("_T91", D5, 110, 110),
             ("_T93", D4, 50, 50), ("_T93", D5, 51, 51),
             (finmind.TAIEX_TRI, D1, None, 1000), (finmind.TAIEX_TRI, D2, None, 1010),
             (finmind.TAIEX_TRI, D4, None, 1030), (finmind.TAIEX_TRI, D5, None, 1050)])
    # trading-day sequence comes from snapshot dates: five days
    for d in ALL_D:
        db.write_snapshot("_TC", d, [Holding("_T94", 1000, 5.0)])  # stale holding, no NEW ever
    # _T91: NEW@D1 with a big ADD@D2 (ADD must NOT spawn a second radar round)
    db.write_changes("_TC", D1, [Change("_T91", "NEW", 1000, 3.0)])
    db.write_changes("_TC", D2, [Change("_T91", "ADD", 900, 2.0),
                                 Change("_T92", "NEW", 500, 1.0)])
    # _T93: NEW@D1 -> EXIT@D3 -> NEW@D4 (re-entry: current round entry = D4)
    db.write_changes("_TC", D1 + dt.timedelta(0), [Change("_T93", "NEW", 200, 1.0)])
    db.write_changes("_TC", D3, [Change("_T93", "EXIT", -200, -1.0)])
    db.write_changes("_TC", D4, [Change("_T93", "NEW", 300, 1.5)])
    yield
    _wipe()


def _rows():
    with db.conn() as c:
        rows = c.execute(
            """select stock_id, entry_date, holding_days, stock_return_pct,
                      bench_return_pct, excess_return_pct
               from open_position where etf_id='_TC' order by stock_id""").fetchall()
    return {r[0]: r for r in rows}


def test_open_rounds_and_returns():
    metrics.refresh_open_positions(D5, etf_ids=["_TC"])
    rows = _rows()
    # _T91: NEW@D1 open; 4 trading days after entry; 10% vs TRI 5% => +5pp
    a = rows["_T91"]
    assert a[1] == D1 and a[2] == 4
    assert round(float(a[3]), 2) == 10.0
    assert round(float(a[4]), 2) == 5.0
    assert round(float(a[5]), 2) == 5.0
    # _T93: re-entry round starts at D4 (old NEW@D1 closed by EXIT@D3)
    g = rows["_T93"]
    assert g[1] == D4 and g[2] == 1
    # 51/50 - 1 = 2% ; TRI 1050/1030 - 1 ≈ 1.9417% => ≈ +0.06pp
    assert round(float(g[5]), 2) == round((51 / 50 - 1050 / 1030) * 100, 2)


def test_foreign_and_stale_holdings():
    metrics.refresh_open_positions(D5, etf_ids=["_TC"])
    rows = _rows()
    # _T92 not in stock_info => listed but unpriceable: excess is null
    b = rows["_T92"]
    assert b[1] == D2 and b[2] == 3
    assert b[3] is None and b[4] is None and b[5] is None
    # _T94 held since day one without a NEW event => excluded entirely
    assert "_T94" not in rows
    # ADD must not create an extra round for _T91
    assert len([k for k in rows if k == "_T91"]) == 1


def test_refresh_is_idempotent_and_exit_disappears():
    metrics.refresh_open_positions(D5, etf_ids=["_TC"])
    metrics.refresh_open_positions(D5, etf_ids=["_TC"])
    assert len(_rows()) == 3
    # exiting _T91 removes it on the next rebuild
    db.write_changes("_TC", D5, [Change("_T91", "EXIT", -1900, -5.0)])
    metrics.refresh_open_positions(D5, etf_ids=["_TC"])
    assert "_T91" not in _rows()
