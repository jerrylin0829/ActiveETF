from pathlib import Path

from activeetf.adapters import fubon
from activeetf.registry import by_id

FIXTURE = Path(__file__).parent / "fixtures" / "fubon_00405A.html"


def test_parses_fixture_into_plausible_holdings():
    holdings = fubon.parse(FIXTURE.read_text())
    assert len(holdings) >= 10
    total = sum(h.weight_pct for h in holdings)
    assert 70 <= total <= 101
    for h in holdings:
        assert h.stock_id and h.shares > 0 and 0 < h.weight_pct < 60
    assert len({h.stock_id for h in holdings}) == len(holdings)


def test_fetch_uses_assets_page(monkeypatch):
    calls = []

    class Resp:
        text = FIXTURE.read_text()

        def raise_for_status(self):
            pass

    monkeypatch.setattr(
        fubon.requests,
        "get",
        lambda url, headers, timeout: calls.append(url) or Resp(),
    )

    holdings = fubon.fetch(by_id("00405A"))

    assert holdings
    assert calls == ["https://websys.fsit.com.tw/FubonETF/Trade/Assets.aspx?stkId=00405A&lan=TW"]
