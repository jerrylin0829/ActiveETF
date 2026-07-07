"""富邦投信 PCF adapter."""
import requests
from bs4 import BeautifulSoup

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_ASSETS_BASE = "https://websys.fsit.com.tw/FubonETF/Trade/Assets.aspx"


def _num(text: str) -> float:
    return float(text.replace(",", "").replace("%", "").strip())


def parse(html: str) -> list[Holding]:
    soup = BeautifulSoup(html, "lxml")
    holdings: list[Holding] = []
    for row in soup.select("table tr"):
        cells = [td.get_text(strip=True) for td in row.select("td")]
        if len(cells) != 5 or not cells[0].isdigit():
            continue
        stock_id, _name, shares, _amount, weight = cells
        shares_int = int(_num(shares))
        weight_pct = _num(weight)
        if shares_int > 0:
            holdings.append(
                Holding(stock_id=stock_id, shares=shares_int, weight_pct=weight_pct)
            )
    return holdings


def fetch(entry: EtfEntry) -> list[Holding]:
    url = entry.pcf_url or f"{_ASSETS_BASE}?stkId={entry.etf_id}&lan=TW"
    r = requests.get(url, headers=UA, timeout=30)
    r.raise_for_status()
    return parse(r.text)
