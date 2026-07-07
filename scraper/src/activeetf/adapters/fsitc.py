"""第一金投信 PCF adapter."""
import json
from urllib.parse import parse_qs, urljoin, urlparse

import requests

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry


def _num(text: str) -> float:
    return float(text.replace(",", "").replace("%", "").strip())


def parse(payload: dict) -> list[Holding]:
    rows = json.loads(payload.get("d") or "[]")
    holdings: list[Holding] = []
    for row in rows:
        if row.get("group") != "1":
            continue
        stock_id = str(row.get("A", "")).strip()
        weight = str(row.get("C", "")).strip()
        shares = str(row.get("D", "")).strip()
        if not stock_id or not weight or not shares:
            continue
        shares_int = int(_num(shares))
        weight_pct = _num(weight)
        if shares_int > 0 and weight_pct > 0:
            holdings.append(
                Holding(stock_id=stock_id, shares=shares_int, weight_pct=weight_pct)
            )
    return holdings


def _fund_id(url: str) -> str:
    fund_id = parse_qs(urlparse(url).query).get("ID", [""])[0]
    if not fund_id:
        raise ValueError("FundDetail URL missing ID")
    return fund_id


def fetch(entry: EtfEntry) -> list[Holding]:
    if not entry.pcf_url:
        raise ValueError("pcf_url is required")
    endpoint = urljoin(entry.pcf_url, "WebAPI.aspx/Get_hd")
    r = requests.post(
        endpoint,
        json={"pStrFundID": _fund_id(entry.pcf_url), "pStrDate": ""},
        headers={**UA, "Referer": entry.pcf_url},
        timeout=30,
    )
    r.raise_for_status()
    return parse(r.json())
