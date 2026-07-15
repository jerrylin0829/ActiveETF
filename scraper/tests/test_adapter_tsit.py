from pathlib import Path

from activeetf.adapters import tsit
from activeetf.registry import by_id

FIXTURE = Path(__file__).parent / "fixtures" / "tsit_00986A.html"
TW_FIXTURE = Path(__file__).parent / "fixtures" / "tsit_00987A.html"
TBODY_HEADER_FIXTURE = Path(__file__).parent / "fixtures" / "tsit_00987A_tbody_header.html"


def test_parses_fixture_into_plausible_holdings():
    holdings = tsit.parse(FIXTURE.read_text())
    assert len(holdings) >= 10
    total = sum(h.weight_pct for h in holdings)
    assert 70 <= total <= 101
    for h in holdings:
        assert h.stock_id and h.shares > 0 and 0 < h.weight_pct < 60
    assert len({h.stock_id for h in holdings}) == len(holdings)
    assert any(h.stock_id == "GOOGL US" for h in holdings)


def test_fetch_uses_etf_detail_page(monkeypatch):
    calls = []

    class Resp:
        text = FIXTURE.read_text()

        def raise_for_status(self):
            pass

    def fake_get(url, headers, timeout):
        calls.append(url)
        return Resp()

    monkeypatch.setattr(tsit.requests, "get", fake_get)

    holdings = tsit.fetch(by_id("00986A"))

    assert holdings
    assert calls == ["https://www.tsit.com.tw/ETF/Home/ETFSeriesDetail/00986A"]


def test_fetch_strips_tt_suffix_for_tw_universe(monkeypatch):
    class Resp:
        text = TW_FIXTURE.read_text()

        def raise_for_status(self):
            pass

    monkeypatch.setattr(tsit.requests, "get", lambda url, headers, timeout: Resp())

    holdings = tsit.fetch(by_id("00987A"))

    assert holdings[0].stock_id == "3017"
    assert all(not h.stock_id.endswith(" TT") for h in holdings)


def test_parses_stock_table_when_headers_are_in_tbody():
    holdings = tsit.parse(TBODY_HEADER_FIXTURE.read_text())

    assert len(holdings) == 2
    assert holdings[0].stock_id == "2330 TT"
    assert holdings[0].shares == 90000
    assert holdings[0].weight_pct == 8.4443
    assert holdings[1].stock_id == "3017 TT"


def test_fetch_retries_when_detail_page_temporarily_has_no_stock_table(monkeypatch):
    calls = []

    class Resp:
        def __init__(self, text):
            self.text = text

        def raise_for_status(self):
            pass

    def fake_get(url, headers, timeout):
        calls.append(url)
        if len(calls) == 1:
            return Resp(
                "<html><body><table><thead><tr><th>名稱</th></tr></thead></table></body></html>"
            )
        return Resp(TW_FIXTURE.read_text())

    monkeypatch.setattr(tsit.requests, "get", fake_get)
    monkeypatch.setattr(tsit.time, "sleep", lambda seconds: None)

    holdings = tsit.fetch(by_id("00987A"))

    assert holdings
    assert len(calls) == 2
