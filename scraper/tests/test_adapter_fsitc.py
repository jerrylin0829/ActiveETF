import datetime as dt
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


def test_fetch_at_uses_slash_date(monkeypatch):
    captured = {}

    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"d": "[]"}

    def fake_post(url, *, json, headers, timeout):
        captured.update(json)
        return Resp()

    monkeypatch.setattr(fsitc.requests, "post", fake_post)

    fsitc.fetch_at(by_id("00994A"), dt.date(2026, 6, 15))

    assert captured["pStrDate"] == "2026/06/15"
    assert captured["pStrFundID"] == "182"


def test_source_date_reads_row_sdate():
    payload = {
        "d": json.dumps(
            [{"group": "1", "A": "2330", "C": "16.91", "D": "345,999",
              "sdate": "2026-07-27"}]
        )
    }

    assert fsitc.source_date(payload) == dt.date(2026, 7, 27)


def test_source_date_none_when_upstream_returns_no_rows():
    assert fsitc.source_date({"d": "[]"}) is None


def test_source_date_none_when_rows_disagree():
    payload = {"d": json.dumps([
        {"group": "1", "A": "2330", "C": "1.0", "D": "1", "sdate": "2026-07-27"},
        {"group": "1", "A": "2317", "C": "1.0", "D": "1", "sdate": "2026-07-28"},
    ])}

    assert fsitc.source_date(payload) is None
