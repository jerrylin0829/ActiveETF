import datetime as dt
import os
import uuid
from dataclasses import dataclass

import pytest

from activeetf import db, finmind, metrics
from activeetf.models import Change, Holding

pytestmark = pytest.mark.skipif(not os.environ.get("SUPABASE_DB_URL"),
                                reason="needs SUPABASE_DB_URL")

# ancient weekday dates far from real data; cleaned up before and after
D1, D2, D3, D4, D5 = (dt.date(2000, 2, 7), dt.date(2000, 2, 8), dt.date(2000, 2, 9),
                      dt.date(2000, 2, 10), dt.date(2000, 2, 11))
ALL_D = (D1, D2, D3, D4, D5)


@dataclass(frozen=True)
class RadarIds:
    etf: str
    second_etf: str
    tri: str
    stocks: tuple[str, ...]

    def stock(self, number: int) -> str:
        return self.stocks[number - 1]

    @property
    def etf_ids(self) -> tuple[str, str]:
        return self.etf, self.second_etf

    @property
    def price_ids(self) -> tuple[str, ...]:
        return self.tri, *self.stocks


@pytest.fixture(scope="session")
def radar_ids():
    run_id = f"{os.getpid()}_{uuid.uuid4().hex[:8]}"
    return RadarIds(
        etf=f"_TC_{run_id}",
        second_etf=f"_TD_{run_id}",
        tri=f"_T90_{run_id}",
        stocks=tuple(f"_T{i}_{run_id}" for i in range(91, 98)),
    )


def _wipe(ids: RadarIds):
    with db.conn() as c:
        c.execute("delete from open_position where etf_id = any(%s)", (list(ids.etf_ids),))
        c.execute("delete from holding_change where etf_id = any(%s)", (list(ids.etf_ids),))
        c.execute("delete from holdings_snapshot where etf_id = any(%s)", (list(ids.etf_ids),))
        c.execute("delete from stock_price where stock_id = any(%s)", (list(ids.price_ids),))
        c.execute("delete from stock_info where stock_id = any(%s)", (list(ids.stocks),))
        c.execute("delete from etf where etf_id = any(%s)", (list(ids.etf_ids),))


@pytest.fixture(autouse=True)
def _seed_and_cleanup(monkeypatch, radar_ids):
    stock1, stock2, stock3, stock4 = radar_ids.stocks[:4]
    monkeypatch.setattr(finmind, "TAIEX_TRI", radar_ids.tri)
    _wipe(radar_ids)
    try:
        with db.conn() as c:
            c.execute(
                "insert into etf (etf_id, name, issuer) values (%s,'c','x')",
                (radar_ids.etf,),
            )
            # stock2 deliberately absent from stock_info => treated like a foreign holding
            c.cursor().executemany(
                "insert into stock_info (stock_id, name, industry, market) "
                "values (%s,%s,%s,%s)",
                [(stock1, "alpha", "水泥工業", "twse"),
                 (stock3, "gamma", "水泥工業", "twse")],
            )
            c.cursor().executemany(
                "insert into stock_price (stock_id, trade_date, close, adj_close) "
                "values (%s,%s,%s,%s)",
                [(stock1, D1, 100, 100), (stock1, D5, 110, 110),
                 (stock3, D4, 50, 50), (stock3, D5, 51, 51),
                 (radar_ids.tri, D1, None, 1000),
                 (radar_ids.tri, D2, None, 1010),
                 (radar_ids.tri, D4, None, 1030),
                 (radar_ids.tri, D5, None, 1050)],
            )
        # trading-day sequence comes from snapshot dates: five days
        for d in ALL_D:
            db.write_snapshot(radar_ids.etf, d, [Holding(stock4, 1000, 5.0)])
        # stock1: NEW@D1 with a big ADD@D2 (ADD must NOT spawn a second radar round)
        db.write_changes(radar_ids.etf, D1, [Change(stock1, "NEW", 1000, 3.0)])
        db.write_changes(radar_ids.etf, D2, [Change(stock1, "ADD", 900, 2.0),
                                            Change(stock2, "NEW", 500, 1.0)])
        db.write_changes(radar_ids.etf, D3, [Change(stock1, "TRIM", -100, -0.2)])
        # stock3: NEW@D1 -> EXIT@D3 -> NEW@D4 (re-entry: current round entry = D4)
        db.write_changes(radar_ids.etf, D1, [Change(stock3, "NEW", 200, 1.0)])
        db.write_changes(radar_ids.etf, D3, [Change(stock3, "EXIT", -200, -1.0)])
        db.write_changes(radar_ids.etf, D4, [Change(stock3, "NEW", 300, 1.5)])
        yield
    finally:
        _wipe(radar_ids)


def _rows(ids: RadarIds, etf_id: str | None = None):
    with db.conn() as c:
        rows = c.execute(
            """select stock_id, entry_date, holding_days, stock_return_pct,
                      bench_return_pct, excess_return_pct
               from open_position where etf_id=%s order by stock_id""",
            (etf_id or ids.etf,),
        ).fetchall()
    return {(r[0], r[1]): r for r in rows}


def test_open_rounds_and_returns(radar_ids):
    stock1 = radar_ids.stock(1)
    stock3 = radar_ids.stock(3)
    metrics.refresh_open_positions(D5, etf_ids=[radar_ids.etf])
    rows = _rows(radar_ids)
    # stock1: NEW@D1 open; 4 trading days after entry; 10% vs TRI 5% => +5pp
    a = rows[(stock1, D1)]
    assert a[1] == D1 and a[2] == 4
    assert round(float(a[3]), 2) == 10.0
    assert round(float(a[4]), 2) == 5.0
    assert round(float(a[5]), 2) == 5.0
    # stock3: re-entry round starts at D4 (old NEW@D1 closed by EXIT@D3)
    g = rows[(stock3, D4)]
    assert g[1] == D4 and g[2] == 1
    # 51/50 - 1 = 2% ; TRI 1050/1030 - 1 ≈ 1.9417% => ≈ +0.06pp
    assert round(float(g[5]), 2) == round((51 / 50 - 1050 / 1030) * 100, 2)


def test_foreign_and_stale_holdings(radar_ids):
    stock1, stock2, stock3, stock4 = radar_ids.stocks[:4]
    metrics.refresh_open_positions(D5, etf_ids=[radar_ids.etf])
    rows = _rows(radar_ids)
    # stock2 not in stock_info => listed but unpriceable: excess is null
    b = rows[(stock2, D2)]
    assert b[1] == D2 and b[2] == 3
    assert b[3] is None and b[4] is None and b[5] is None
    # stock4 held since day one without a NEW event => excluded entirely
    assert not any(stock_id == stock4 for stock_id, _entry in rows)
    # ADD and TRIM must not create another round or alter the NEW entry date.
    assert {key for key in rows if key[0] == stock1} == {(stock1, D1)}
    # EXIT closes stock3's first round; the later NEW starts the only open round.
    assert {key for key in rows if key[0] == stock3} == {(stock3, D4)}


def test_refresh_is_idempotent_and_exit_disappears(radar_ids):
    stock1 = radar_ids.stock(1)
    metrics.refresh_open_positions(D5, etf_ids=[radar_ids.etf])
    metrics.refresh_open_positions(D5, etf_ids=[radar_ids.etf])
    assert len(_rows(radar_ids)) == 3
    # exiting stock1 removes it on the next rebuild
    db.write_changes(radar_ids.etf, D5, [Change(stock1, "EXIT", -1900, -5.0)])
    metrics.refresh_open_positions(D5, etf_ids=[radar_ids.etf])
    assert not any(stock_id == stock1 for stock_id, _entry in _rows(radar_ids))


def test_returns_use_the_latest_common_end_date(monkeypatch, radar_ids):
    stock5 = radar_ids.stock(5)
    with db.conn() as c:
        c.execute(
            "insert into stock_info (stock_id, name, industry, market) "
            "values (%s,'delta','水泥工業','twse')",
            (stock5,),
        )
        c.cursor().executemany(
            "insert into stock_price (stock_id, trade_date, close, adj_close) "
            "values (%s,%s,%s,%s)",
            [(stock5, D1, 100, 100), (stock5, D4, 110, 110)],
        )
    db.write_changes(radar_ids.etf, D1, [Change(stock5, "NEW", 100, 1.0)])
    monkeypatch.setattr(finmind, "adj_prices", lambda *_args: [])

    metrics.refresh_open_positions(D5, etf_ids=[radar_ids.etf])

    row = _rows(radar_ids)[(stock5, D1)]
    assert round(float(row[3]), 2) == 10.0
    assert round(float(row[4]), 2) == 3.0
    assert round(float(row[5]), 2) == 7.0


def test_same_day_new_with_complete_prices_is_zero_return(radar_ids):
    stock6 = radar_ids.stock(6)
    with db.conn() as c:
        c.execute(
            "insert into stock_info (stock_id, name, industry, market) "
            "values (%s,'epsilon','水泥工業','twse')",
            (stock6,),
        )
        c.execute(
            "insert into stock_price (stock_id, trade_date, close, adj_close) "
            "values (%s,%s,%s,%s)",
            (stock6, D5, 100, 100),
        )
    db.write_changes(radar_ids.etf, D5, [Change(stock6, "NEW", 100, 1.0)])

    metrics.refresh_open_positions(D5, etf_ids=[radar_ids.etf])

    row = _rows(radar_ids)[(stock6, D5)]
    assert row[2] == 0
    assert float(row[3]) == 0
    assert float(row[4]) == 0
    assert float(row[5]) == 0


def test_new_without_cached_entry_history_fetches_previous_common_day(
    monkeypatch, radar_ids
):
    stock7 = radar_ids.stock(7)
    with db.conn() as c:
        c.execute("delete from holding_change where etf_id = %s", (radar_ids.etf,))
        c.execute(
            "delete from stock_price where stock_id = %s and trade_date < %s",
            (radar_ids.tri, D5),
        )
        c.execute(
            "insert into stock_info (stock_id, name, industry, market) "
            "values (%s,'zeta','水泥工業','twse')",
            (stock7,),
        )
        c.execute(
            "insert into stock_price (stock_id, trade_date, close, adj_close) "
            "values (%s,%s,%s,%s)",
            (stock7, D5, 110, 110),
        )
    db.write_changes(radar_ids.etf, D2, [Change(stock7, "NEW", 100, 1.0)])

    adj_calls = []
    tri_calls = []

    def fake_adj_prices(stock_id, start, end):
        adj_calls.append((stock_id, start, end))
        return [
            {"stock_id": stock_id, "date": str(D1), "raw_close": 100, "close": 100},
            {"stock_id": stock_id, "date": str(D5), "raw_close": 110, "close": 110},
        ]

    def fake_total_return_index(start, end):
        tri_calls.append((start, end))
        return [
            {"date": str(D1), "price": 1000},
            {"date": str(D5), "price": 1050},
        ]

    monkeypatch.setattr(finmind, "adj_prices", fake_adj_prices)
    monkeypatch.setattr(finmind, "total_return_index", fake_total_return_index)

    metrics.refresh_open_positions(D5, etf_ids=[radar_ids.etf])

    assert adj_calls == [(stock7, str(D1), str(D5))]
    assert tri_calls == [(str(D1), str(D5))]
    row = _rows(radar_ids)[(stock7, D2)]
    assert round(float(row[3]), 2) == 10.0
    assert round(float(row[4]), 2) == 5.0
    assert round(float(row[5]), 2) == 5.0


def test_old_cached_common_day_refreshes_to_nearer_upstream_day(
    monkeypatch, radar_ids
):
    stock7 = radar_ids.stock(7)
    with db.conn() as c:
        c.execute("delete from holding_change where etf_id = %s", (radar_ids.etf,))
        c.execute(
            "delete from stock_price where stock_id = %s and trade_date not in (%s, %s)",
            (radar_ids.tri, D1, D5),
        )
        c.execute(
            "insert into stock_info (stock_id, name, industry, market) "
            "values (%s,'zeta','水泥工業','twse')",
            (stock7,),
        )
        c.cursor().executemany(
            "insert into stock_price (stock_id, trade_date, close, adj_close) "
            "values (%s,%s,%s,%s)",
            [(stock7, D1, 100, 100), (stock7, D5, 110, 110)],
        )
    db.write_changes(radar_ids.etf, D4, [Change(stock7, "NEW", 100, 1.0)])

    adj_calls = []
    tri_calls = []

    def fake_adj_prices(stock_id, start, end):
        adj_calls.append((stock_id, start, end))
        return [
            {"stock_id": stock_id, "date": str(D3), "raw_close": 105, "close": 105},
            {"stock_id": stock_id, "date": str(D5), "raw_close": 110, "close": 110},
        ]

    def fake_total_return_index(start, end):
        tri_calls.append((start, end))
        return [
            {"date": str(D3), "price": 1030},
            {"date": str(D5), "price": 1050},
        ]

    monkeypatch.setattr(finmind, "adj_prices", fake_adj_prices)
    monkeypatch.setattr(finmind, "total_return_index", fake_total_return_index)

    metrics.refresh_open_positions(D5, etf_ids=[radar_ids.etf])

    assert adj_calls == [(stock7, str(D1), str(D5))]
    assert tri_calls == [(str(D1), str(D5))]
    row = _rows(radar_ids)[(stock7, D4)]
    assert round(float(row[3]), 4) == round((110 / 105 - 1) * 100, 4)
    assert round(float(row[4]), 4) == round((1050 / 1030 - 1) * 100, 4)
    assert round(float(row[5]), 4) == round((110 / 105 - 1050 / 1030) * 100, 4)


def test_shared_stock_across_etfs_loads_prices_once(monkeypatch, radar_ids):
    stock7 = radar_ids.stock(7)
    with db.conn() as c:
        c.execute("delete from holding_change where etf_id = %s", (radar_ids.etf,))
        c.execute(
            "delete from stock_price where stock_id = %s and trade_date not in (%s, %s)",
            (radar_ids.tri, D1, D5),
        )
        c.execute(
            "insert into etf (etf_id, name, issuer) values (%s,'d','x')",
            (radar_ids.second_etf,),
        )
        c.execute(
            "insert into stock_info (stock_id, name, industry, market) "
            "values (%s,'zeta','水泥工業','twse')",
            (stock7,),
        )
        c.cursor().executemany(
            "insert into stock_price (stock_id, trade_date, close, adj_close) "
            "values (%s,%s,%s,%s)",
            [(stock7, D1, 100, 100), (stock7, D5, 110, 110)],
        )
    for etf_id in radar_ids.etf_ids:
        db.write_changes(etf_id, D4, [Change(stock7, "NEW", 100, 1.0)])

    adj_calls = []
    tri_calls = []

    def fake_adj_prices(stock_id, start, end):
        adj_calls.append((stock_id, start, end))
        return [
            {"stock_id": stock_id, "date": str(D3), "raw_close": 105, "close": 105},
            {"stock_id": stock_id, "date": str(D5), "raw_close": 110, "close": 110},
        ]

    def fake_total_return_index(start, end):
        tri_calls.append((start, end))
        return [
            {"date": str(D3), "price": 1030},
            {"date": str(D5), "price": 1050},
        ]

    monkeypatch.setattr(finmind, "adj_prices", fake_adj_prices)
    monkeypatch.setattr(finmind, "total_return_index", fake_total_return_index)

    metrics.refresh_open_positions(D5, etf_ids=list(radar_ids.etf_ids))

    assert adj_calls == [(stock7, str(D1), str(D5))]
    assert tri_calls == [(str(D1), str(D5))]
    for etf_id in radar_ids.etf_ids:
        row = _rows(radar_ids, etf_id)[(stock7, D4)]
        assert round(float(row[3]), 4) == round((110 / 105 - 1) * 100, 4)
        assert round(float(row[4]), 4) == round((1050 / 1030 - 1) * 100, 4)
        assert round(float(row[5]), 4) == round((110 / 105 - 1050 / 1030) * 100, 4)
