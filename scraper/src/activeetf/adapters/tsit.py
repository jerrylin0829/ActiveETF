"""台新投信 PCF adapter."""
import time

import requests
from bs4 import BeautifulSoup
from bs4.element import Tag

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_DETAIL_BASE = "https://www.tsit.com.tw/ETF/Home/ETFSeriesDetail"
_STOCK_HEADERS = ["代號", "名稱", "股數", "持股權重"]
_EMPTY_HOLDINGS_RETRY_ATTEMPTS = 3
_EMPTY_HOLDINGS_RETRY_SECONDS = 5


def _num(text: str) -> float:
    cleaned = (
        text.replace(",", "")
        .replace("%", "")
        .replace("(", "-")
        .replace(")", "")
        .strip()
    )
    return float(cleaned)


def _cell_texts(row: Tag) -> list[str]:
    return [cell.get_text(strip=True) for cell in row.select("th, td")]


def _stock_rows(table: Tag) -> list[Tag]:
    thead_headers = [th.get_text(strip=True) for th in table.select("thead th")]
    if thead_headers == _STOCK_HEADERS:
        return table.select("tbody tr")

    rows = table.select("tr")
    for index, row in enumerate(rows):
        if _cell_texts(row) == _STOCK_HEADERS:
            return rows[index + 1 :]

    return []


def parse(html: str) -> list[Holding]:
    soup = BeautifulSoup(html, "lxml")
    holdings: list[Holding] = []
    for table in soup.select("table"):
        rows = _stock_rows(table)
        if not rows:
            continue
        for row in rows:
            cells = [td.get_text(strip=True) for td in row.select("td")]
            if len(cells) != 4:
                continue
            stock_id, _name, shares, weight = cells
            shares_int = int(_num(shares))
            weight_pct = _num(weight)
            if stock_id and shares_int > 0:
                holdings.append(
                    Holding(stock_id=stock_id, shares=shares_int, weight_pct=weight_pct)
                )
        break
    return holdings


def fetch(entry: EtfEntry) -> list[Holding]:
    url = entry.pcf_url or f"{_DETAIL_BASE}/{entry.etf_id}"
    holdings: list[Holding] = []
    for attempt in range(_EMPTY_HOLDINGS_RETRY_ATTEMPTS):
        r = requests.get(url, headers=UA, timeout=30)
        r.raise_for_status()
        holdings = parse(r.text)
        if holdings or attempt == _EMPTY_HOLDINGS_RETRY_ATTEMPTS - 1:
            break
        time.sleep(_EMPTY_HOLDINGS_RETRY_SECONDS)

    if entry.universe == "tw":
        return [
            Holding(
                stock_id=h.stock_id.removesuffix(" TT"),
                shares=h.shares,
                weight_pct=h.weight_pct,
            )
            for h in holdings
        ]
    return holdings
