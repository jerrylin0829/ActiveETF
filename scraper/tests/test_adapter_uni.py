import datetime as dt
import json
from pathlib import Path

import pytest

from activeetf.adapters import uni
from activeetf.registry import by_id

FIXTURE = Path(__file__).parent / "fixtures" / "uni_00981A.json"


def test_parses_stock_assets_into_plausible_holdings():
    holdings = uni.parse(json.loads(FIXTURE.read_text()))

    assert len(holdings) == 50
    assert sum(h.weight_pct == 0 for h in holdings) == 15
    assert sum(h.weight_pct for h in holdings) == pytest.approx(96.19)
    for holding in holdings:
        assert holding.stock_id
        assert holding.shares > 0
        assert 0 <= holding.weight_pct < 60
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


def test_fetch_at_sends_roc_date_and_specific_flag(monkeypatch):
    captured = {}
    payload = json.loads(FIXTURE.read_text())

    class Resp:
        is_redirect = False

        def __init__(self, payload=None):
            self._payload = payload

        def raise_for_status(self):
            pass

        def json(self):
            return self._payload

    class Session:
        def get(self, *args, **kwargs):
            return Resp()

        def post(self, url, *, json, headers, timeout):
            captured.update(json)
            return Resp(payload)

    monkeypatch.setattr(uni.requests, "Session", Session)

    holdings, upstream_date = uni.fetch_at(by_id("00981A"), dt.date(2026, 6, 15))

    assert captured["date"] == "115/06/15"
    assert captured["specificDate"] is True
    assert captured["fundCode"] == uni._FUND_CODES["00981A"]
    assert holdings[0].stock_id
    assert upstream_date == dt.date(2026, 7, 8)


# 上游自報的資料日：pcf[].TranDate（PostDate 是「適用交易日」，比資料日晚一個交易日）

def test_source_date_reads_tran_date_not_post_date():
    payload = json.loads(FIXTURE.read_text())

    assert uni.source_date(payload) == dt.date(2026, 7, 8)


def test_source_date_parses_aspnet_epoch_in_taipei_time():
    # 正式站回的是 /Date(ms)/；該 epoch 為台北午夜，用 UTC 解會早一天
    payload = {"pcf": [{"TranDate": "/Date(1785081600000)/"}]}

    assert uni.source_date(payload) == dt.date(2026, 7, 27)


def test_source_date_none_when_upstream_omits_it():
    assert uni.source_date({"pcf": []}) is None
