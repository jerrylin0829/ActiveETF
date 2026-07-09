"""安聯投信 PCF adapter."""
import requests

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_API_BASE = "https://etf.allianzgi.com.tw/webapi/api"
_ORIGIN = "https://etf.allianzgi.com.tw"
_FUND_IDS = {
    "00984A": "E0001",
    "00993A": "E0002",
    "00402A": "E0003",
}


def _num(value: str) -> float:
    return float(value.replace(",", "").replace("%", "").strip())


def parse(payload: dict) -> list[Holding]:
    body = payload.get("Entries", payload)
    holdings: list[Holding] = []
    for table in body.get("DynamicTableData", []):
        if not str(table.get("TableTitle", "")).startswith("股票"):
            continue
        columns = [column["Name"] for column in table.get("Columns", [])]
        for values in table.get("Rows", []):
            row = dict(zip(columns, values, strict=False))
            shares = int(_num(row["股數"]))
            weight = _num(row["權重(%)"])
            if shares > 0 and weight > 0:
                holdings.append(
                    Holding(
                        stock_id=str(row["股票代號"]).strip(),
                        shares=shares,
                        weight_pct=weight,
                    )
                )
    return holdings


def fetch(entry: EtfEntry) -> list[Holding]:
    session = requests.Session()
    headers = {
        **UA,
        "Origin": _ORIGIN,
        "Referer": entry.pcf_url or f"{_ORIGIN}/list-trade",
    }
    response = session.get(
        f"{_API_BASE}/AntiForgery/GetAntiForgeryToken",
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()
    xsrf_token = session.cookies["X-XSRF-TOKEN"]
    response = session.post(
        f"{_API_BASE}/Fund/GetFundTradeInfo",
        headers={
            **headers,
            "Content-Type": "application/json",
            "X-XSRF-TOKEN": xsrf_token,
        },
        json={"FundNo": _FUND_IDS[entry.etf_id], "Date": None},
        timeout=30,
    )
    response.raise_for_status()
    return parse(response.json())
