import json
from pathlib import Path

from activeetf.adapters import yuanta
from activeetf.registry import by_id

FIXTURE = Path(__file__).parent / "fixtures" / "yuanta_00990A.json"


def test_parses_api_payload_into_plausible_holdings():
    holdings = yuanta.parse(json.loads(FIXTURE.read_text()))

    assert len(holdings) >= 10
    assert 70 <= sum(h.weight_pct for h in holdings) <= 101
    for holding in holdings:
        assert holding.stock_id
        assert holding.shares > 0
        assert 0 < holding.weight_pct < 60
    assert len({h.stock_id for h in holdings}) == len(holdings)


def test_fetch_calls_official_pcf_api(monkeypatch):
    calls = []

    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return json.loads(FIXTURE.read_text())

    def fake_get(url, *, headers, params, timeout):
        calls.append((url, params))
        return Resp()

    monkeypatch.setattr(yuanta.requests, "get", fake_get)

    holdings = yuanta.fetch(by_id("00990A"))

    assert holdings
    assert calls == [
        (
            "https://etfapi.yuantaetfs.com/ectranslation/api/bridge",
            {
                "APIType": "ETFAPI",
                "CompanyName": "YUANTAFUNDS",
                "PageName": "/tradeInfo/pcf/00990A",
                "DeviceId": "null",
                "FuncId": "PCF/Daily",
                "AppName": "ETF",
                "Device": "3",
                "Platform": "ETF",
                "ticker": "00990A",
                "ndate": "",
            },
        )
    ]
