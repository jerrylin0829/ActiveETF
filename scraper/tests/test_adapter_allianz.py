import json
from pathlib import Path

from activeetf.adapters import allianz
from activeetf.registry import by_id

FIXTURE = Path(__file__).parent / "fixtures" / "allianz_00984A.json"


def test_parses_dynamic_stock_table_into_plausible_holdings():
    holdings = allianz.parse(json.loads(FIXTURE.read_text()))

    assert len(holdings) >= 10
    assert 70 <= sum(h.weight_pct for h in holdings) <= 101
    for holding in holdings:
        assert holding.stock_id
        assert holding.shares > 0
        assert 0 < holding.weight_pct < 60
    assert len({h.stock_id for h in holdings}) == len(holdings)


def test_fetch_gets_antiforgery_token_then_posts_fund_id(monkeypatch):
    calls = []
    payload = json.loads(FIXTURE.read_text())

    class Resp:
        def __init__(self, body):
            self.body = body

        def raise_for_status(self):
            pass

        def json(self):
            return self.body

    class Session:
        def __init__(self):
            self.cookies = {"X-XSRF-TOKEN": "xsrf-token"}

        def get(self, url, *, headers, timeout):
            calls.append(("GET", url, headers, None))
            return Resp({"token": "xsrf-token"})

        def post(self, url, *, headers, json, timeout):
            calls.append(("POST", url, headers, json))
            return Resp(payload)

    monkeypatch.setattr(allianz.requests, "Session", Session)

    holdings = allianz.fetch(by_id("00984A"))

    assert holdings
    assert calls[0][1].endswith("/AntiForgery/GetAntiForgeryToken")
    assert calls[1][1].endswith("/Fund/GetFundTradeInfo")
    assert calls[1][2]["X-XSRF-TOKEN"] == "xsrf-token"
    assert calls[1][3] == {"FundNo": "E0001", "Date": None}
