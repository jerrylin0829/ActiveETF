import datetime as dt

import pytest
from activeetf.models import Holding
from activeetf.validate import (
    SourceDateMismatch,
    ValidationError,
    validate,
    validate_source_date,
)

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


@pytest.mark.parametrize("weight", [-5.0, float("nan"), None])
def test_rejects_negative_non_finite_and_missing_weight(weight):
    holdings = [_h("2330", weight), _h("2317", 80)]

    with pytest.raises(ValidationError, match="invalid weight"):
        validate(holdings, prev_count=2, known_ids=KNOWN, universe="tw")


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


# 回補專用第四道：上游回傳的資料日必須等於要寫入的 trade_date
# （2026-07-31 實測：六支 fetch_at 有四支的日期語意與每日路徑不一致）

def test_source_date_equal_to_trade_date_passes():
    validate_source_date(dt.date(2026, 7, 28), dt.date(2026, 7, 28))


def test_source_date_off_by_one_trading_day_is_rejected():
    with pytest.raises(SourceDateMismatch) as ex:
        validate_source_date(dt.date(2026, 7, 27), dt.date(2026, 7, 28))
    assert "2026-07-27" in str(ex.value) and "2026-07-28" in str(ex.value)


def test_source_date_mismatch_is_a_validation_error_so_it_never_writes():
    with pytest.raises(ValidationError):
        validate_source_date(dt.date(2026, 7, 29), dt.date(2026, 7, 28))


def test_missing_source_date_is_rejected_rather_than_assumed_correct():
    with pytest.raises(SourceDateMismatch):
        validate_source_date(None, dt.date(2026, 7, 28))
