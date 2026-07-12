from activeetf.models import Holding
from activeetf.diff import diff_snapshots

def _snap(*rows):
    return {r[0]: Holding(stock_id=r[0], shares=r[1], weight_pct=r[2]) for r in rows}

def test_new_and_exit():
    prev = _snap(("2330", 1000, 50.0))
    curr = _snap(("2317", 500, 48.0))
    types = {c.stock_id: c.change_type for c in diff_snapshots(prev, curr)}
    assert types == {"2317": "NEW", "2330": "EXIT"}

def test_add_and_trim_require_both_thresholds():
    prev = _snap(("2330", 1000, 50.0), ("2317", 1000, 30.0), ("2454", 1000, 15.0))
    curr = _snap(("2330", 1500, 50.30), ("2317", 900, 29.90), ("2454", 1001, 15.001))
    changes = {c.stock_id: c for c in diff_snapshots(prev, curr)}
    assert changes["2330"].change_type == "ADD"     # 股數+ 且 |Δw|=0.30 ≥ 0.05
    assert changes["2317"].change_type == "TRIM"    # 股數- 且 |Δw|=0.10 ≥ 0.05
    assert "2454" not in changes                     # Δw 0.001 < 0.05 → 申贖/雜訊過濾

def test_price_only_weight_move_is_not_a_change():
    prev = _snap(("2330", 1000, 50.0))
    curr = _snap(("2330", 1000, 53.0))   # 股數沒動，純價格波動
    assert diff_snapshots(prev, curr) == []

def test_deltas_are_signed():
    prev = _snap(("2330", 1000, 50.0))
    curr = _snap(("2330", 1500, 50.4))
    c = diff_snapshots(prev, curr)[0]
    assert c.shares_delta == 500 and abs(c.weight_delta_pct - 0.4) < 1e-9
