import json

from activeetf.adapters import fsitc
from activeetf.registry import by_id


def test_parses_webapi_payload_into_holdings():
    payload = {
        "d": json.dumps(
            [
                {"group": "1", "A": "2330", "B": "台積電", "C": "16.91", "D": "345,999"},
                {"group": "1", "A": "2383", "B": "台光電", "C": "7.30", "D": "70,000"},
                {"group": "4", "A": "其他資產", "B": "100"},
            ]
        )
    }

    holdings = fsitc.parse(payload)

    assert [h.stock_id for h in holdings] == ["2330", "2383"]
    assert holdings[0].shares == 345_999
    assert holdings[0].weight_pct == 16.91


def test_fetch_posts_fund_id_to_get_hd(monkeypatch):
    calls = []

    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"d": json.dumps([{"group": "1", "A": "2330", "C": "16.91", "D": "345,999"}])}

    def fake_post(url, json, headers, timeout):
        calls.append((url, json))
        return Resp()

    monkeypatch.setattr(fsitc.requests, "post", fake_post)

    holdings = fsitc.fetch(by_id("00994A"))

    assert holdings
    assert calls == [
        (
            "https://www.fsitc.com.tw/WebAPI.aspx/Get_hd",
            {"pStrFundID": "182", "pStrDate": ""},
        )
    ]
