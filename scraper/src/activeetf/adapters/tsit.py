"""台新投信 PCF adapter."""
import requests
from bs4 import BeautifulSoup

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_DETAIL_BASE = "https://www.tsit.com.tw/ETF/Home/ETFSeriesDetail"


def _num(text: str) -> float:
    cleaned = (
        text.replace(",", "")
        .replace("%", "")
        .replace("(", "-")
        .replace(")", "")
        .strip()
    )
    return float(cleaned)


def parse(html: str) -> list[Holding]:
    soup = BeautifulSoup(html, "lxml")
    holdings: list[Holding] = []
    for table in soup.select("table"):
        headers = [th.get_text(strip=True) for th in table.select("thead th")]
        if headers != ["代號", "名稱", "股數", "持股權重"]:
            continue
        for row in table.select("tbody tr"):
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
    r = requests.get(url, headers=UA, timeout=30)
    r.raise_for_status()
    holdings = parse(r.text)
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
