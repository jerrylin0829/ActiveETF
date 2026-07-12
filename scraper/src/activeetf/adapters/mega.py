"""兆豐投信 PCF adapter."""
import requests
from bs4 import BeautifulSoup

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_FUND_IDS = {"00996A": "23"}


def _num(text: str) -> float:
    return float(text.replace(",", "").replace("%", "").strip())


def parse(html: str) -> list[Holding]:
    soup = BeautifulSoup(html, "lxml")
    holdings: list[Holding] = []
    for row in soup.select("#divStockCash table.table-stock tbody tr"):
        cells = [cell.get_text(strip=True) for cell in row.select("td")]
        if len(cells) != 4:
            continue
        stock_id, _name, shares, weight = cells
        shares_int = int(_num(shares))
        weight_pct = _num(weight)
        if stock_id and shares_int > 0 and weight_pct > 0:
            holdings.append(
                Holding(
                    stock_id=stock_id,
                    shares=shares_int,
                    weight_pct=weight_pct,
                )
            )
    return holdings


def fetch(entry: EtfEntry) -> list[Holding]:
    if not entry.pcf_url:
        raise ValueError("pcf_url is required")
    session = requests.Session()
    response = session.get(entry.pcf_url, headers=UA, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "lxml")
    data = {
        field["name"]: field.get("value", "")
        for field in soup.select("input[type=hidden][name]")
    }
    data.update(
        {
            "ctl00$ContentPlaceHolder1$category_id": "16",
            "ctl00$ContentPlaceHolder1$fund_id": _FUND_IDS[entry.etf_id],
            "ctl00$ContentPlaceHolder1$button1": "查 詢",
        }
    )
    response = session.post(
        entry.pcf_url,
        headers=UA,
        data=data,
        timeout=30,
    )
    response.raise_for_status()
    return parse(response.text)
