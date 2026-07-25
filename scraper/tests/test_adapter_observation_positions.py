import json

from activeetf.adapters import (
    ab,
    allianz,
    cathay,
    ctbc,
    fsitc,
    fuhua,
    jpm,
    kgi,
    mega,
    uni,
    yuanta,
)


def assert_observation_is_preserved(holdings):
    assert [(holding.stock_id, holding.shares, holding.weight_pct) for holding in holdings] == [
        ("2330", 1_000, 0.0)
    ]


def test_allianz_preserves_zero_weight_stock():
    holdings = allianz.parse(
        {
            "Entries": {
                "DynamicTableData": [
                    {
                        "TableTitle": "股票",
                        "Columns": [
                            {"Name": "股票代號"},
                            {"Name": "股數"},
                            {"Name": "權重(%)"},
                        ],
                        "Rows": [["2330", "1,000", "0.00%"]],
                    }
                ]
            }
        }
    )

    assert_observation_is_preserved(holdings)


def test_first_preserves_zero_weight_stock():
    holdings = fsitc.parse(
        {
            "d": json.dumps(
                [{"group": "1", "A": "2330", "C": "0.00%", "D": "1,000"}]
            )
        }
    )

    assert_observation_is_preserved(holdings)


def test_ab_preserves_zero_weight_stock():
    holdings = ab.parse(
        {
            "domesticHoldings": [
                {
                    "holdingCategory": "holdings-section-equity",
                    "holdings": [
                        {
                            "holdingCode": "2330",
                            "holdingShares": "1000",
                            "holdingPerc": "0",
                        }
                    ],
                }
            ]
        }
    )

    assert_observation_is_preserved(holdings)


def test_kgi_preserves_zero_weight_stock():
    holdings = kgi.parse(
        """
        <table>
          <tr><th>股票代號</th><th>股票名稱</th><th>股數</th><th>權重(%)</th></tr>
          <tr><td>2330</td><td>台積電</td><td>1,000</td><td>0.00%</td></tr>
        </table>
        """
    )

    assert_observation_is_preserved(holdings)


def test_ctbc_preserves_zero_weight_stock():
    holdings = ctbc.parse(
        {
            "Detail": [
                {
                    "Code": "STOCK",
                    "Data": [{"code_": "2330", "qty_": "1,000", "weights_": "0"}],
                }
            ]
        }
    )

    assert_observation_is_preserved(holdings)


def test_cathay_preserves_zero_weight_stock(monkeypatch):
    monkeypatch.setattr(
        cathay,
        "_rows",
        lambda _content: [
            {"A": "股票代號", "C": "股數", "D": "持股權重"},
            {"A": "2330", "C": "1,000", "D": "0.00%"},
            {"A": "期貨"},
        ],
    )

    assert_observation_is_preserved(cathay.parse_xlsx(b"fixture"))


def test_mega_preserves_zero_weight_stock():
    holdings = mega.parse(
        """
        <div id="divStockCash">
          <table class="table-stock"><tbody>
            <tr><td>2330</td><td>台積電</td><td>1,000</td><td>0.00%</td></tr>
          </tbody></table>
        </div>
        """
    )

    assert_observation_is_preserved(holdings)


def test_fuhua_preserves_zero_weight_stock(monkeypatch):
    monkeypatch.setattr(
        fuhua,
        "_sheet_rows",
        lambda _content: [
            {"A": "證券代號", "C": "股數"},
            {"A": "2330", "C": "1,000", "E": "0.00%"},
        ],
    )

    assert_observation_is_preserved(fuhua.parse_xlsx(b"fixture"))


def test_jpm_preserves_zero_weight_stock(monkeypatch):
    monkeypatch.setattr(
        jpm,
        "_rows",
        lambda _content: [
            {"A": "Record Type", "B": "Fund Ticker"},
            {"O": "1000000"},
            {"E": "Constituent Ticker", "H": "Constituent Type"},
            {"E": "2330", "H": "Equity", "J": "1000", "R": "0"},
        ],
    )

    assert_observation_is_preserved(jpm.parse_xlsx(b"fixture"))


def test_uni_preserves_zero_weight_stock():
    holdings = uni.parse(
        {
            "asset": [
                {
                    "AssetCode": "ST",
                    "Details": [
                        {"DetailCode": "2330", "Share": "1000", "NavRate": "0"}
                    ],
                }
            ]
        }
    )

    assert_observation_is_preserved(holdings)


def test_yuanta_preserves_zero_weight_stock():
    holdings = yuanta.parse(
        {
            "FundWeights": {
                "StockWeights": [{"code": "2330", "qty": "1000", "weights": "0"}]
            }
        }
    )

    assert_observation_is_preserved(holdings)
