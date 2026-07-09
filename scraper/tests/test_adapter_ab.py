import json
from pathlib import Path

from activeetf.adapters import ab
from activeetf.registry import by_id

FIXTURE = Path(__file__).parent / "fixtures" / "ab_00404A.json"


def test_parses_equity_section_into_plausible_holdings():
    holdings = ab.parse(json.loads(FIXTURE.read_text()))

    assert len(holdings) >= 10
    assert 70 <= sum(h.weight_pct for h in holdings) <= 101
    for holding in holdings:
        assert holding.stock_id
        assert holding.shares > 0
        assert 0 < holding.weight_pct < 60
    assert len({h.stock_id for h in holdings}) == len(holdings)


def test_fetch_calls_official_holdings_api(monkeypatch):
    calls = []

    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return json.loads(FIXTURE.read_text())

    monkeypatch.setattr(
        ab.requests,
        "get",
        lambda url, *, headers, timeout: calls.append(url) or Resp(),
    )

    holdings = ab.fetch(by_id("00404A"))

    assert holdings
    assert calls == [
        "https://webapi.alliancebernstein.com/v2/funds/tw/zh-tw/investor/"
        "TW00000404A5/holdings"
    ]
