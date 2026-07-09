"""國泰投信持股權重 adapter."""
import re
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO

import requests

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_API_BASE = "https://cwapi.cathaysite.com.tw/api/ETF"
_FUND_CODES = {"00400A": "EA"}
_NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return [
        "".join(text.text or "" for text in item.findall(".//x:t", _NS))
        for item in root.findall("x:si", _NS)
    ]


def _cell_value(cell: ET.Element, shared: list[str]) -> str:
    value = cell.find("x:v", _NS)
    if value is None:
        return ""
    text = value.text or ""
    return shared[int(text)] if cell.attrib.get("t") == "s" else text


def _rows(content: bytes) -> list[dict[str, str]]:
    with zipfile.ZipFile(BytesIO(content)) as archive:
        shared = _shared_strings(archive)
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))

    rows: list[dict[str, str]] = []
    for row in sheet.findall(".//x:row", _NS):
        values: dict[str, str] = {}
        for cell in row.findall("x:c", _NS):
            column = re.match(r"[A-Z]+", cell.attrib["r"])
            if column:
                values[column.group(0)] = _cell_value(cell, shared).strip()
        rows.append(values)
    return rows


def _num(value: str) -> float:
    return float(value.replace(",", "").replace("%", "").strip())


def parse_xlsx(content: bytes) -> list[Holding]:
    rows = _rows(content)
    try:
        start = next(
            i
            for i, row in enumerate(rows)
            if row.get("A") == "股票代號"
            and row.get("C") == "股數"
            and row.get("D") == "持股權重"
        )
    except StopIteration as ex:
        raise ValueError("Cathay workbook missing stock holdings header") from ex

    holdings: list[Holding] = []
    for row in rows[start + 1 :]:
        if row.get("A") == "期貨":
            break
        stock_id = row.get("A", "").strip()
        shares_text = row.get("C", "").strip()
        weight_text = row.get("D", "").strip()
        if not stock_id or not shares_text or not weight_text:
            continue
        shares = int(_num(shares_text))
        weight = _num(weight_text)
        if shares > 0 and weight > 0:
            holdings.append(
                Holding(
                    stock_id=stock_id,
                    shares=shares,
                    weight_pct=weight,
                )
            )
    return holdings


def fetch(entry: EtfEntry) -> list[Holding]:
    fund_code = _FUND_CODES[entry.etf_id]
    info = requests.get(
        f"{_API_BASE}/GetETFInfoMain",
        params={"FundCode": fund_code, "status": 1},
        headers=UA,
        timeout=30,
    )
    info.raise_for_status()
    payload = info.json()
    if payload.get("returnCode") != "2000":
        raise ValueError("Cathay fund info request failed")
    nav_date = payload["result"]["navDate"].replace("/", "-")

    workbook = requests.get(
        f"{_API_BASE}/DownloadETFWeightExcel",
        params={
            "FundCode": fund_code,
            "SearchDate": nav_date,
            "status": 1,
        },
        headers=UA,
        timeout=30,
    )
    workbook.raise_for_status()
    return parse_xlsx(workbook.content)
