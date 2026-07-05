import responses
from activeetf import finmind

BASE = "https://api.finmindtrade.com/api/v4/data"

def _mock(dataset_data):
    responses.add(responses.GET, BASE, json={"status": 200, "msg": "success", "data": dataset_data})

@responses.activate
def test_market_close_returns_rows(monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "t")
    _mock([{"stock_id": "2330", "date": "2026-07-03", "close": 1000.0}])
    rows = finmind.market_close("2026-07-03")
    assert rows[0]["stock_id"] == "2330"

@responses.activate
def test_error_status_raises(monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "t")
    responses.add(responses.GET, BASE, json={"status": 400, "msg": "bad token"})
    try:
        finmind.market_close("2026-07-03")
        assert False
    except RuntimeError as e:
        assert "bad token" in str(e)

@responses.activate
def test_is_trading_day_false_when_empty(monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "t")
    _mock([])
    assert finmind.is_trading_day("2026-07-04") is False
