"""中國信託投信 PCF adapter."""
import datetime as dt

import requests

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_API_BASE = "https://www.ctbcinvestments.com.tw/API"
_TOKEN_SEED = "www.ctbcinvestments.com"
_FUND_IDS = {
    "00406A": "E0038",
    "00983A": "E0034",
    "00995A": "E0036",
}


def _num(value: str | float) -> float:
    return float(str(value).replace(",", "").replace("%", "").strip())


def _data(response: requests.Response) -> dict:
    payload = response.json()
    if payload.get("ResultCode") != 0:
        raise ValueError(payload.get("ResultMsg") or "CTBC API error")
    return payload["Data"]


def parse(payload: dict) -> list[Holding]:
    body = payload
    if "Detail" not in body and isinstance(body.get("Data"), dict):
        body = body["Data"]
    holdings: list[Holding] = []
    for section in body.get("Detail", []):
        if section.get("Code") != "STOCK":
            continue
        for row in section.get("Data", []):
            shares = int(_num(row["qty_"]))
            weight = _num(row["weights_"])
            if shares > 0 and weight > 0:
                holdings.append(
                    Holding(
                        stock_id=str(row["code_"]).strip(),
                        shares=shares,
                        weight_pct=weight,
                    )
                )
    return holdings


def fetch(entry: EtfEntry) -> list[Holding]:
    headers = {**UA, "content-type": "application/json; charset=utf-8"}
    token_response = requests.post(
        f"{_API_BASE}/home/AuthToken",
        params={"token": _TOKEN_SEED},
        json={"token": _TOKEN_SEED},
        headers=headers,
        timeout=30,
    )
    token_response.raise_for_status()
    token = _data(token_response)["token"]

    response = requests.post(
        f"{_API_BASE}/etf/Buyback",
        params={"token": token},
        json={
            "token": token,
            "FID": _FUND_IDS[entry.etf_id],
            "StartDate": dt.date.today().isoformat(),
        },
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()
    return parse(_data(response))
