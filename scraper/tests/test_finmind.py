import pandas as pd
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


class _FakeTicker:
    def __init__(self, symbol, hist_by_symbol):
        self.symbol = symbol
        self._hist_by_symbol = hist_by_symbol

    def history(self, start, end, auto_adjust):
        assert auto_adjust is True
        return self._hist_by_symbol.get(self.symbol, pd.DataFrame())


def test_adj_prices_uses_yfinance_tw_suffix(monkeypatch):
    idx = pd.to_datetime(["2026-07-01", "2026-07-02"])
    hist = pd.DataFrame({"Close": [610.0, 615.5]}, index=idx)
    monkeypatch.setattr(finmind.yf, "Ticker",
                        lambda s: _FakeTicker(s, {"2330.TW": hist}))
    rows = finmind.adj_prices("2330", "2026-07-01", "2026-07-02")
    assert rows == [
        {"stock_id": "2330", "date": "2026-07-01", "close": 610.0},
        {"stock_id": "2330", "date": "2026-07-02", "close": 615.5},
    ]


def test_adj_prices_falls_back_to_two_suffix_when_tw_empty(monkeypatch):
    idx = pd.to_datetime(["2026-07-01"])
    hist = pd.DataFrame({"Close": [88.8]}, index=idx)
    monkeypatch.setattr(finmind.yf, "Ticker",
                        lambda s: _FakeTicker(s, {"6488.TWO": hist}))
    rows = finmind.adj_prices("6488", "2026-07-01", "2026-07-01")
    assert rows == [{"stock_id": "6488", "date": "2026-07-01", "close": 88.8}]


def test_adj_prices_returns_empty_when_no_suffix_has_data(monkeypatch):
    monkeypatch.setattr(finmind.yf, "Ticker", lambda s: _FakeTicker(s, {}))
    assert finmind.adj_prices("0000", "2026-07-01", "2026-07-01") == []
