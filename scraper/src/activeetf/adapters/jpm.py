"""摩根投信 PCF adapter."""
import re
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO

import requests

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

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


def parse_xlsx(content: bytes) -> list[Holding]:
    rows = _rows(content)
    try:
        fund_header = next(
            i
            for i, row in enumerate(rows)
            if row.get("A") == "Record Type" and row.get("B") == "Fund Ticker"
        )
        total_market_value = float(rows[fund_header + 1]["O"])
        holdings_header = next(
            i
            for i, row in enumerate(rows)
            if row.get("E") == "Constituent Ticker"
            and row.get("H") == "Constituent Type"
        )
    except (StopIteration, KeyError, ValueError) as ex:
        raise ValueError("JPM PCF workbook missing required fields") from ex

    holdings: list[Holding] = []
    for row in rows[holdings_header + 1 :]:
        if row.get("H") != "Equity":
            continue
        stock_id = row.get("E", "").strip()
        shares = int(float(row.get("J", "0")))
        market_value = float(row.get("R", "0"))
        weight = market_value / total_market_value * 100
        if stock_id and shares > 0 and weight > 0:
            holdings.append(
                Holding(
                    stock_id=stock_id,
                    shares=shares,
                    weight_pct=weight,
                )
            )
    return holdings


def fetch(entry: EtfEntry) -> list[Holding]:
    if not entry.pcf_url:
        raise ValueError("pcf_url is required")
    response = requests.get(entry.pcf_url, headers=UA, timeout=30)
    response.raise_for_status()
    return parse_xlsx(response.content)
