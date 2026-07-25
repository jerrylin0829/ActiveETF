import datetime as dt

from activeetf.diff import diff_snapshots
from activeetf.models import Holding
from activeetf.metrics import build_rounds, open_round_stock_ids, score_rounds

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


def test_low_weight_round_closes_after_observation_disappears():
    snapshots = [
        (D("2026-06-01"), Holding("2330", 1_000, 1.0)),
        (D("2026-06-02"), Holding("2330", 100, 0.01)),
        (D("2026-06-03"), Holding("2330", 1, 0)),
        (D("2026-06-04"), None),
    ]
    previous = {}
    open_stock_ids = set()
    events = []

    for trade_date, holding in snapshots:
        current = {} if holding is None else {"2330": holding}
        changes = diff_snapshots(
            previous,
            current,
            open_stock_ids=open_stock_ids,
        )
        for change in changes:
            events.append(
                (
                    trade_date,
                    change.stock_id,
                    change.change_type,
                    change.shares_delta,
                    0,
                )
            )
            if change.change_type == "NEW":
                open_stock_ids.add(change.stock_id)
            elif change.change_type == "EXIT":
                open_stock_ids.discard(change.stock_id)
        previous = current

    assert [event[2] for event in events] == ["NEW", "TRIM", "EXIT"]
    assert build_rounds(events)[0].exit == D("2026-06-04")


def test_baseline_add_round_closes_after_observation_disappears():
    snapshots = [
        (D("2026-06-01"), Holding("2330", 1_000, 1.0)),
        (D("2026-06-02"), Holding("2330", 1_200, 1.2)),
        (D("2026-06-03"), Holding("2330", 100, 0.01)),
        (D("2026-06-04"), Holding("2330", 1, 0)),
        (D("2026-06-05"), None),
    ]
    previous = {"2330": snapshots[0][1]}
    events = []

    for trade_date, holding in snapshots[1:]:
        current = {} if holding is None else {"2330": holding}
        changes = diff_snapshots(
            previous,
            current,
            open_stock_ids=open_round_stock_ids(events),
        )
        previous_shares = previous.get("2330")
        events.extend(
            (
                trade_date,
                change.stock_id,
                change.change_type,
                change.shares_delta,
                previous_shares.shares if previous_shares else 0,
            )
            for change in changes
        )
        previous = current

    assert [event[2] for event in events] == ["ADD", "TRIM", "EXIT"]
    assert build_rounds(events)[0].exit == D("2026-06-05")


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
