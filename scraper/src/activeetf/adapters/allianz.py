"""安聯投信 PCF adapter."""
import datetime as dt

import requests

from activeetf.adapters import base
from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_API_BASE = "https://etf.allianzgi.com.tw/webapi/api"
# 請求 D 拿到的是 D 的前一交易日資料（CPcfdate = D、CNavDt = D-1）
HISTORY_REQUEST_OFFSET = 1


def source_date(payload: dict) -> dt.date | None:
    """上游自報的資料日 = `Entries.CNavDt`。

    `CPcfdate` 等於請求日，用它核對等於什麼都沒檢查。
    """
    body = payload.get("Entries") or payload
    if not isinstance(body, dict):
        return None
    return base.parse_upstream_date(body.get("CNavDt"))
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
            if shares > 0:
                holdings.append(
                    Holding(
                        stock_id=str(row["股票代號"]).strip(),
                        shares=shares,
                        weight_pct=weight,
                    )
                )
    return holdings


def _fetch_pcf(entry: EtfEntry, date: dt.date | None) -> dict:
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
        json={
            "FundNo": _FUND_IDS[entry.etf_id],
            "Date": date.isoformat() if date else None,
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def fetch(entry: EtfEntry) -> list[Holding]:
    return parse(_fetch_pcf(entry, None))


def fetch_at(
    entry: EtfEntry, date: dt.date
) -> tuple[list[Holding], dt.date | None]:
    payload = _fetch_pcf(entry, date)
    return parse(payload), source_date(payload)
