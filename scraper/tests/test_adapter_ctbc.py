import json
from pathlib import Path

from activeetf.adapters import ctbc
from activeetf.registry import by_id

FIXTURE = Path(__file__).parent / "fixtures" / "ctbc_00406A.json"


def test_parses_buyback_payload_into_plausible_holdings():
    holdings = ctbc.parse(json.loads(FIXTURE.read_text()))

    assert len(holdings) >= 10
    assert 70 <= sum(h.weight_pct for h in holdings) <= 101
    for holding in holdings:
        assert holding.stock_id
        assert holding.shares > 0
        assert 0 < holding.weight_pct < 60
    assert len({h.stock_id for h in holdings}) == len(holdings)


def test_fetch_gets_token_then_posts_fund_id(monkeypatch):
    calls = []
    payload = json.loads(FIXTURE.read_text())

    class Resp:
        def __init__(self, body):
            self.body = body

        def raise_for_status(self):
            pass

        def json(self):
            return self.body

    def fake_post(url, *, params, json, headers, timeout):
        calls.append((url, params, json))
        if url.endswith("/home/AuthToken"):
            return Resp({"ResultCode": 0, "Data": {"token": "short-lived-token"}})
        return Resp(payload)

    monkeypatch.setattr(ctbc.requests, "post", fake_post)

    holdings = ctbc.fetch(by_id("00406A"))

    assert holdings
    assert calls[0] == (
        "https://www.ctbcinvestments.com.tw/API/home/AuthToken",
        {"token": "www.ctbcinvestments.com"},
        {"token": "www.ctbcinvestments.com"},
    )
    assert calls[1][0].endswith("/etf/Buyback")
    assert calls[1][1] == {"token": "short-lived-token"}
    assert calls[1][2]["token"] == "short-lived-token"
    assert calls[1][2]["FID"] == "E0038"
    assert calls[1][2]["StartDate"]
