"""復華投信 PCF adapter."""
import re
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_BASE = "https://www.fhtrust.com.tw"
_NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _num(text: str) -> float:
    return float(text.replace(",", "").replace("%", "").strip())


def _shared_strings(z: zipfile.ZipFile) -> list[str]:
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    return [
        "".join(t.text or "" for t in item.findall(".//x:t", _NS))
        for item in root.findall("x:si", _NS)
    ]


def _cell_value(cell: ET.Element, shared: list[str]) -> str:
    value = cell.find("x:v", _NS)
    if value is None:
        return ""
    text = value.text or ""
    if cell.attrib.get("t") == "s":
        return shared[int(text)]
    return text


def _sheet_rows(content: bytes) -> list[dict[str, str]]:
    with zipfile.ZipFile(BytesIO(content)) as z:
        shared = _shared_strings(z)
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))

    rows: list[dict[str, str]] = []
    for row in sheet.findall(".//x:row", _NS):
        values: dict[str, str] = {}
        for cell in row.findall("x:c", _NS):
            match = re.match(r"[A-Z]+", cell.attrib["r"])
            if match:
                values[match.group(0)] = _cell_value(cell, shared).strip()
        rows.append(values)
    return rows


def parse_xlsx(content: bytes) -> list[Holding]:
    rows = _sheet_rows(content)
    try:
        start = next(
            i
            for i, row in enumerate(rows)
            if row.get("A") == "證券代號" and row.get("C") == "股數"
        )
    except StopIteration as ex:
        raise ValueError("assets Excel missing holdings header") from ex

    holdings: list[Holding] = []
    for row in rows[start + 1 :]:
        stock_id = row.get("A", "").strip()
        shares = row.get("C", "").strip()
        weight = row.get("E", "").strip()
        if not stock_id or not shares or not weight:
            continue
        shares_int = int(_num(shares))
        weight_pct = _num(weight)
        if shares_int > 0 and weight_pct > 0:
            holdings.append(
                Holding(stock_id=stock_id, shares=shares_int, weight_pct=weight_pct)
            )
    return holdings


def _assets_url(detail_html: str, detail_url: str) -> str:
    soup = BeautifulSoup(detail_html, "lxml")
    link = soup.select_one('a[href*="/api/assetsExcel/"]')
    if link is None or not link.get("href"):
        raise ValueError("assets Excel link not found")
    return urljoin(detail_url, link["href"])


def fetch(entry: EtfEntry) -> list[Holding]:
    if not entry.pcf_url:
        raise ValueError("pcf_url is required")
    detail = requests.get(entry.pcf_url, headers=UA, timeout=30)
    detail.raise_for_status()
    assets_url = _assets_url(detail.text, entry.pcf_url)
    assets = requests.get(assets_url, headers=UA, timeout=30)
    assets.raise_for_status()
    return parse_xlsx(assets.content)
