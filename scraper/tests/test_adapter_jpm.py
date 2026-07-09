from pathlib import Path

from activeetf.adapters import jpm
from activeetf.registry import by_id

FIXTURE = Path(__file__).parent / "fixtures" / "jpm_00401A.xlsx"


def test_parses_equities_into_plausible_holdings():
    holdings = jpm.parse_xlsx(FIXTURE.read_bytes())

    assert len(holdings) >= 10
    assert 70 <= sum(h.weight_pct for h in holdings) <= 101
    for holding in holdings:
        assert holding.stock_id
        assert holding.shares > 0
        assert 0 < holding.weight_pct < 60
    assert len({h.stock_id for h in holdings}) == len(holdings)


def test_fetch_downloads_official_pcf_workbook(monkeypatch):
    calls = []

    class Resp:
        content = FIXTURE.read_bytes()

        def raise_for_status(self):
            pass

    monkeypatch.setattr(
        jpm.requests,
        "get",
        lambda url, *, headers, timeout: calls.append(url) or Resp(),
    )

    holdings = jpm.fetch(by_id("00401A"))

    assert holdings
    assert calls == [
        "https://cdn.jpmorganfunds.com/content/dam/jpm-am-aem/asiapacific/"
        "tw/zh/regulatory/etf-supplement/"
        "jpm_apac_tw_etf_pcf_updates_00401A_TW00000401A1.xlsx"
    ]
