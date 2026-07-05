from activeetf.models import Holding

def test_holding_is_frozen_value_object():
    h = Holding(stock_id="2330", shares=1000, weight_pct=8.5)
    assert h.stock_id == "2330"
    try:
        h.shares = 1  # type: ignore
        assert False, "should be frozen"
    except AttributeError:
        pass
