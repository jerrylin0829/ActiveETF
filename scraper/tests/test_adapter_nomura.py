import json
from pathlib import Path

from activeetf.adapters import nomura
from activeetf.registry import by_id

FIXTURE = Path(__file__).parent / "fixtures" / "nomura_00980A.json"


def test_parses_fixture_into_plausible_holdings():
    payload = json.loads(FIXTURE.read_text())
    holdings = nomura.parse(payload)
    assert len(holdings) >= 10
    total = sum(h.weight_pct for h in holdings)
    assert 70 <= total <= 101
    for h in holdings:
        assert h.stock_id and h.shares > 0 and 0 < h.weight_pct < 60
    assert len({h.stock_id for h in holdings}) == len(holdings)


def test_request_body_uses_latest_date_when_fetching(monkeypatch):
    calls = []

    class Resp:
        def __init__(self, body):
            self._body = body

        def raise_for_status(self):
            pass

        def json(self):
            return self._body

    def fake_post(url, json, headers, timeout):
        calls.append((url, json))
        if url.endswith("GetFundTradeInfoDate"):
            return Resp({"Entries": {"LatestDate": "2026/07/08"}})
        return Resp(json_fixture)

    json_fixture = json.loads(FIXTURE.read_text())
    monkeypatch.setattr(nomura.requests, "post", fake_post)

    holdings = nomura.fetch(by_id("00980A"))

    assert holdings
    assert calls[0][1]["FundNo"] == "00980A"
    assert calls[1][1]["Date"] == "2026/07/08"
