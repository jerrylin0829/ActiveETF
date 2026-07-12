from pathlib import Path

from activeetf.adapters import mega
from activeetf.registry import by_id

FIXTURE = Path(__file__).parent / "fixtures" / "mega_00996A.html"


def test_parses_fixture_into_plausible_holdings():
    holdings = mega.parse(FIXTURE.read_text())

    assert len(holdings) >= 10
    assert 70 <= sum(h.weight_pct for h in holdings) <= 101
    for holding in holdings:
        assert holding.stock_id
        assert holding.shares > 0
        assert 0 < holding.weight_pct < 60
    assert len({h.stock_id for h in holdings}) == len(holdings)


def test_fetch_selects_active_etf_with_aspnet_form(monkeypatch):
    calls = []

    class Resp:
        text = FIXTURE.read_text()

        def raise_for_status(self):
            pass

    class Session:
        def get(self, url, *, headers, timeout):
            calls.append(("GET", url, None))
            return Resp()

        def post(self, url, *, headers, data, timeout):
            calls.append(("POST", url, data))
            return Resp()

    monkeypatch.setattr(mega.requests, "Session", Session)

    holdings = mega.fetch(by_id("00996A"))

    assert holdings
    assert calls[0] == (
        "GET",
        "https://www.megafunds.com.tw/MEGA/etf/trade_pcf.aspx",
        None,
    )
    method, url, data = calls[1]
    assert method == "POST"
    assert url == calls[0][1]
    assert data["ctl00$ContentPlaceHolder1$category_id"] == "16"
    assert data["ctl00$ContentPlaceHolder1$fund_id"] == "23"
    assert data["ctl00$ContentPlaceHolder1$button1"] == "查 詢"
    assert "__VIEWSTATE" in data
