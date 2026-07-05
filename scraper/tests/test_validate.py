import pytest
from activeetf.models import Holding
from activeetf.validate import validate, ValidationError

KNOWN = {"2330", "2317", "2454"}

def _h(sid="2330", w=30.0, shares=1000):
    return Holding(stock_id=sid, shares=shares, weight_pct=w)

def test_passes_normal_holdings():
    hs = [_h("2330", 40), _h("2317", 30), _h("2454", 25)]
    validate(hs, prev_count=3, known_ids=KNOWN, universe="tw")  # 不丟例外

def test_rejects_empty():
    with pytest.raises(ValidationError):
        validate([], prev_count=3, known_ids=KNOWN, universe="tw")

def test_rejects_weight_sum_out_of_range():
    with pytest.raises(ValidationError, match="weight sum"):
        validate([_h("2330", 30)], prev_count=1, known_ids=KNOWN, universe="tw")   # 30 < 70
    with pytest.raises(ValidationError, match="weight sum"):
        validate([_h("2330", 60), _h("2317", 60)], prev_count=2, known_ids=KNOWN, universe="tw")  # 120 > 101

def test_rejects_count_collapse():
    hs = [_h("2330", 80)]
    with pytest.raises(ValidationError, match="count"):
        validate(hs, prev_count=80, known_ids=KNOWN, universe="tw")  # 80 筆 → 1 筆

def test_first_day_no_prev_count_ok():
    validate([_h("2330", 80)], prev_count=None, known_ids=KNOWN, universe="tw")

def test_rejects_unknown_stock_id_for_tw():
    with pytest.raises(ValidationError, match="unknown"):
        validate([_h("9999", 80)], prev_count=None, known_ids=KNOWN, universe="tw")

def test_global_universe_skips_id_check():
    validate([_h("NVDA", 80)], prev_count=None, known_ids=KNOWN, universe="global")
