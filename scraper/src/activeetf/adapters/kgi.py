"""凱基投信 PCF adapter."""
import requests
from bs4 import BeautifulSoup

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry


def _num(text: str) -> float:
    return float(text.replace(",", "").replace("%", "").strip())


def parse(html: str) -> list[Holding]:
    soup = BeautifulSoup(html, "lxml")
    by_stock: dict[str, Holding] = {}
    for table in soup.select("table"):
        header = [th.get_text(strip=True) for th in table.select("th")]
        if not {"股票代號", "股數", "權重(%)"}.issubset(set(header)):
            continue
        for row in table.select("tr"):
            cells = [td.get_text(strip=True) for td in row.select("td")]
            if len(cells) != 4 or not cells[0].isdigit():
                continue
            stock_id, _name, shares, weight = cells
            shares_int = int(_num(shares))
            weight_pct = _num(weight)
            if shares_int > 0 and weight_pct > 0 and stock_id not in by_stock:
                by_stock[stock_id] = Holding(
                    stock_id=stock_id, shares=shares_int, weight_pct=weight_pct
                )
    return list(by_stock.values())


def fetch(entry: EtfEntry) -> list[Holding]:
    if not entry.pcf_url:
        raise ValueError("pcf_url is required")
    r = requests.get(entry.pcf_url, headers=UA, timeout=30)
    r.raise_for_status()
    return parse(r.text)
