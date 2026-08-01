import datetime as dt
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


def test_fetch_at_sends_token_in_both_places(monkeypatch):
    captured = {}

    class Resp:
        def __init__(self, body):
            self.body = body

        def raise_for_status(self):
            pass

        def json(self):
            return self.body

    def fake_post(url, *, params, json, headers, timeout):
        if url.endswith("/home/AuthToken"):
            return Resp({"ResultCode": 0, "Data": {"token": "tok"}})
        captured["params"] = params
        captured["body"] = json
        return Resp({"ResultCode": 0, "Data": {"Detail": []}})

    monkeypatch.setattr(ctbc.requests, "post", fake_post)

    ctbc.fetch_at(by_id("00406A"), dt.date(2026, 6, 15))

    assert captured["body"]["StartDate"] == "2026-06-15"
    assert captured["params"]["token"] == "tok"
    assert captured["body"]["token"] == "tok"


def test_source_date_reads_announcement_date():
    payload = json.loads(FIXTURE.read_text())

    assert ctbc.source_date(payload) == dt.date(2026, 7, 9)


def test_source_date_none_when_upstream_omits_it():
    assert ctbc.source_date({"Data": []}) is None


def test_source_date_none_when_rows_disagree():
    payload = {"Detail": [], "Data": [
        {"公告日": "2026/07/27"},
        {"公告日": "2026/07/28"},
    ]}

    assert ctbc.source_date(payload) is None
