from activeetf.adapters import kgi
from activeetf.registry import by_id


HTML = """
<table>
  <tr><th>股票代號</th><th>股票名稱</th><th>股數</th><th>權重(%)</th></tr>
  <tr><td>2330</td><td>台積電</td><td>905,000</td><td>9.18</td></tr>
  <tr><td>2454</td><td>聯發科</td><td>408,000</td><td>6.83</td></tr>
</table>
<table>
  <tr><th>股票代號</th><th>股票名稱</th><th>股數</th><th>權重(%)</th></tr>
  <tr><td>2330</td><td>台積電</td><td>905,000</td><td>9.18</td></tr>
</table>
"""


def test_parses_static_holdings_table_and_dedupes_mobile_copy():
    holdings = kgi.parse(HTML)

    assert [h.stock_id for h in holdings] == ["2330", "2454"]
    assert holdings[0].shares == 905_000
    assert holdings[0].weight_pct == 9.18


def test_fetch_uses_fund_detail_page(monkeypatch):
    calls = []

    class Resp:
        text = HTML

        def raise_for_status(self):
            pass

    monkeypatch.setattr(
        kgi.requests,
        "get",
        lambda url, headers, timeout: calls.append(url) or Resp(),
    )

    holdings = kgi.fetch(by_id("00407A"))

    assert holdings
    assert calls == ["https://www.kgifund.com.tw/Fund/Detail?fundID=J024"]
