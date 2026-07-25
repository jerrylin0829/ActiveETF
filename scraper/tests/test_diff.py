import pytest

from activeetf.models import Change, Holding
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


def test_new_observation_does_not_emit_event():
    assert diff_snapshots({}, _snap(("2330", 1_000, 0))) == []


def test_observation_becoming_material_is_new_with_actual_delta():
    changes = diff_snapshots(
        _snap(("2330", 1_000, 0)),
        _snap(("2330", 5_000, 1.2)),
    )

    assert changes == [
        Change(
            stock_id="2330",
            change_type="NEW",
            shares_delta=4_000,
            weight_delta_pct=1.2,
        )
    ]


def test_material_becoming_observation_is_exit_with_actual_delta():
    changes = diff_snapshots(
        _snap(("2330", 5_000, 1.2)),
        _snap(("2330", 1_000, 0)),
    )

    assert changes == [
        Change(
            stock_id="2330",
            change_type="EXIT",
            shares_delta=-4_000,
            weight_delta_pct=-1.2,
        )
    ]


def test_removed_observation_does_not_emit_event():
    assert diff_snapshots(_snap(("2330", 1_000, 0)), {}) == []


def test_removed_observation_closes_existing_new_round():
    assert diff_snapshots(
        _snap(("2330", 1_000, 0)),
        {},
        open_stock_ids={"2330"},
    ) == [
        Change(
            stock_id="2330",
            change_type="EXIT",
            shares_delta=-1_000,
            weight_delta_pct=0,
        )
    ]


def test_open_round_returning_from_observation_is_not_new_again():
    assert diff_snapshots(
        _snap(("2330", 1_000, 0)),
        _snap(("2330", 5_000, 1.2)),
        open_stock_ids={"2330"},
    ) == [
        Change(
            stock_id="2330",
            change_type="ADD",
            shares_delta=4_000,
            weight_delta_pct=1.2,
        )
    ]


@pytest.mark.parametrize(
    ("previous_weight", "current_weight"),
    [(0, 0.01), (0.01, 0)],
)
def test_observation_boundary_requires_share_change(previous_weight, current_weight):
    assert diff_snapshots(
        _snap(("2330", 1_000, previous_weight)),
        _snap(("2330", 1_000, current_weight)),
    ) == []


@pytest.mark.parametrize(
    ("previous_shares", "previous_weight", "current_shares", "current_weight"),
    [(1_000, 0, 2_000, 0.04), (2_000, 0.04, 1_000, 0)],
)
def test_observation_boundary_requires_weight_threshold(
    previous_shares,
    previous_weight,
    current_shares,
    current_weight,
):
    assert diff_snapshots(
        _snap(("2330", previous_shares, previous_weight)),
        _snap(("2330", current_shares, current_weight)),
    ) == []
