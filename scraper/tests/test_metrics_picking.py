import datetime as dt

from activeetf.metrics import build_rounds, score_rounds

D = dt.date.fromisoformat


def test_build_rounds_pairs_entry_with_exit():
    events = [
        (D("2026-06-01"), "2330", "NEW", 1000, 0),
        (D("2026-06-10"), "2330", "EXIT", -1000, 1000),
        (D("2026-06-05"), "2317", "NEW", 500, 0),
    ]
    rounds = build_rounds(events)
    actual = [(r.entry, r.stock_id, r.exit) for r in rounds]
    assert (D("2026-06-01"), "2330", D("2026-06-10")) in actual
    assert any(r.stock_id == "2317" and r.exit is None for r in rounds)


def test_add_below_10pct_shares_is_not_an_event():
    events = [
        (D("2026-06-01"), "2330", "NEW", 1000, 0),
        (D("2026-06-03"), "2330", "ADD", 50, 1000),
        (D("2026-06-04"), "2330", "ADD", 200, 1050),
    ]
    rounds = build_rounds(events)
    assert len([r for r in rounds if r.stock_id == "2330"]) == 2


def test_score_rounds_realized_vs_open():
    stock = {D("2026-06-01") + dt.timedelta(days=i): 100 + i for i in range(15)}
    tri = {D("2026-06-01") + dt.timedelta(days=i): 100 + i * 0.1 for i in range(15)}
    rounds = build_rounds([(D("2026-06-01"), "2330", "NEW", 1000, 0)])
    res = score_rounds(rounds, {"2330": stock}, tri, asof=D("2026-06-15"), min_open_days=5)
    assert res["picking_open_wins"] == 1 and res["picking_open_total"] == 1
    assert res["picking_realized_total"] == 0


def test_open_round_below_min_days_not_scored():
    stock = {D("2026-06-01"): 100.0, D("2026-06-02"): 130.0}
    tri = dict(stock)
    rounds = build_rounds([(D("2026-06-01"), "2330", "NEW", 1000, 0)])
    res = score_rounds(rounds, {"2330": stock}, tri, asof=D("2026-06-02"), min_open_days=5)
    assert res["picking_open_total"] == 0
