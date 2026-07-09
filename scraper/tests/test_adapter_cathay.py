from pathlib import Path

from activeetf.adapters import cathay
from activeetf.registry import by_id

FIXTURE = Path(__file__).parent / "fixtures" / "cathay_00400A.xlsx"


def test_parses_stock_section_into_plausible_holdings():
    holdings = cathay.parse_xlsx(FIXTURE.read_bytes())

    assert len(holdings) >= 10
    assert 70 <= sum(h.weight_pct for h in holdings) <= 101
    for holding in holdings:
        assert holding.stock_id
        assert holding.shares > 0
        assert 0 < holding.weight_pct < 60
    assert len({h.stock_id for h in holdings}) == len(holdings)


def test_fetch_uses_latest_nav_date_for_official_weight_workbook(monkeypatch):
    calls = []

    class Resp:
        def __init__(self, *, payload=None, content=b""):
            self._payload = payload
            self.content = content

        def raise_for_status(self):
            pass

        def json(self):
            return self._payload

    def fake_get(url, *, params, headers, timeout):
        calls.append((url, params))
        if url.endswith("/GetETFInfoMain"):
            return Resp(
                payload={
                    "returnCode": "2000",
                    "result": {"navDate": "2026/07/08"},
                }
            )
        return Resp(content=FIXTURE.read_bytes())

    monkeypatch.setattr(cathay.requests, "get", fake_get)

    holdings = cathay.fetch(by_id("00400A"))

    assert holdings
    assert calls == [
        (
            "https://cwapi.cathaysite.com.tw/api/ETF/GetETFInfoMain",
            {"FundCode": "EA", "status": 1},
        ),
        (
            "https://cwapi.cathaysite.com.tw/api/ETF/DownloadETFWeightExcel",
            {"FundCode": "EA", "SearchDate": "2026-07-08", "status": 1},
        ),
    ]
