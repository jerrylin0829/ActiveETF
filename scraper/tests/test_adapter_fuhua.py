from io import BytesIO
from zipfile import ZipFile

from activeetf.adapters import fuhua
from activeetf.registry import by_id


def _xlsx(rows: list[list[str]]) -> bytes:
    strings: list[str] = []
    indexes: dict[str, int] = {}

    def idx(value: str) -> int:
        if value not in indexes:
            indexes[value] = len(strings)
            strings.append(value)
        return indexes[value]

    all_rows = [
        ["復華測試基金（證劵代碼：00991A）"],
        [],
        ["日期: 2026/07/03"],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        ["證券代號", "證券名稱", "股數", "金額", "權重(%)"],
        *rows,
    ]
    row_xml = []
    for r_no, row in enumerate(all_rows, start=1):
        cells = []
        for c_no, value in enumerate(row, start=1):
            col = chr(ord("A") + c_no - 1)
            cells.append(f'<c r="{col}{r_no}" t="s"><v>{idx(value)}</v></c>')
        row_xml.append(f'<row r="{r_no}">{"".join(cells)}</row>')

    shared = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + "".join(f"<si><t>{s}</t></si>" for s in strings)
        + "</sst>"
    )
    sheet = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(row_xml)}</sheetData></worksheet>'
    )
    out = BytesIO()
    with ZipFile(out, "w") as z:
        z.writestr("xl/sharedStrings.xml", shared)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return out.getvalue()


def test_parses_assets_excel_into_holdings():
    rows = [
        ["2330", "台灣積體", "3,500,000", "8,557,500,000", "11.590%"],
        ["2327", "國巨股份", "6,150,000", "6,426,750,000", "8.704%"],
        ["2383", "台光電子", "850,000", "5,168,000,000", "6.999%"],
    ]

    holdings = fuhua.parse_xlsx(_xlsx(rows))

    assert [h.stock_id for h in holdings] == ["2330", "2327", "2383"]
    assert holdings[0].shares == 3_500_000
    assert holdings[0].weight_pct == 11.59


def test_fetch_uses_assets_excel_link(monkeypatch):
    calls = []
    xlsx = _xlsx([["2330", "台灣積體", "3,500,000", "8,557,500,000", "11.590%"]])

    class Resp:
        def __init__(self, text="", content=b""):
            self.text = text
            self.content = content

        def raise_for_status(self):
            pass

    def fake_get(url, headers, timeout):
        calls.append(url)
        if url.endswith("/ETF23"):
            return Resp('<a href="/api/assetsExcel/ETF23/20260703">下載</a>')
        return Resp(content=xlsx)

    monkeypatch.setattr(fuhua.requests, "get", fake_get)

    holdings = fuhua.fetch(by_id("00991A"))

    assert holdings
    assert calls == [
        "https://www.fhtrust.com.tw/ETF/etf_detail/ETF23",
        "https://www.fhtrust.com.tw/api/assetsExcel/ETF23/20260703",
    ]
