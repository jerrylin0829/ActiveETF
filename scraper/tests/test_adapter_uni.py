import json
from pathlib import Path

from activeetf.adapters import uni
from activeetf.registry import by_id

FIXTURE = Path(__file__).parent / "fixtures" / "uni_00981A.json"


def test_parses_stock_assets_into_plausible_holdings():
    holdings = uni.parse(json.loads(FIXTURE.read_text()))

    assert len(holdings) >= 10
    assert 70 <= sum(h.weight_pct for h in holdings) <= 101
    for holding in holdings:
        assert holding.stock_id
        assert holding.shares > 0
        assert 0 < holding.weight_pct < 60
    assert len({h.stock_id for h in holdings}) == len(holdings)


def test_fetch_bootstraps_cookie_and_calls_official_pcf_api(monkeypatch):
    calls = []

    class Resp:
        def __init__(self, *, redirect=False, payload=None):
            self.is_redirect = redirect
            self._payload = payload

        def raise_for_status(self):
            pass

        def json(self):
            return self._payload

    class Session:
        def get(self, url, **kwargs):
            calls.append(("get", url, kwargs))
            return Resp(redirect=len(calls) == 1)

        def post(self, url, **kwargs):
            calls.append(("post", url, kwargs))
            return Resp(payload=json.loads(FIXTURE.read_text()))

    monkeypatch.setattr(uni.requests, "Session", Session)
    monkeypatch.setattr(uni, "_roc_today", lambda: "115/07/09")

    holdings = uni.fetch(by_id("00981A"))

    assert holdings
    assert [call[:2] for call in calls] == [
        ("get", "https://www.ezmoney.com.tw/ETF/Transaction/PCF"),
        ("get", "https://www.ezmoney.com.tw/ETF/Transaction/PCF"),
        ("post", "https://www.ezmoney.com.tw/ETF/Transaction/GetPCF"),
    ]
    assert calls[-1][2]["json"] == {
        "fundCode": "49YTW",
        "date": "115/07/09",
        "specificDate": False,
    }
