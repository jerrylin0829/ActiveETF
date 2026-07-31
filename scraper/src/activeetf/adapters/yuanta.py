"""元大投信 PCF adapter."""
import datetime as dt

import requests

from activeetf.adapters import base
from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_API_URL = "https://etfapi.yuantaetfs.com/ectranslation/api/bridge"
# 請求 D 拿到的是 D 的次一交易日資料，故目標交易日 T 要請求 T 的前一交易日
HISTORY_REQUEST_OFFSET = -1


def source_date(payload: dict) -> dt.date | None:
    """上游自報的資料日 = `PCF.upddate`。"""
    return base.parse_upstream_date((payload.get("PCF") or {}).get("upddate"))


def parse(payload: dict) -> list[Holding]:
    holdings: list[Holding] = []
    for row in payload.get("FundWeights", {}).get("StockWeights", []):
        shares = int(float(row["qty"]))
        weight = float(row["weights"])
        if shares > 0:
            holdings.append(
                Holding(
                    stock_id=str(row["code"]).strip(),
                    shares=shares,
                    weight_pct=weight,
                )
            )
    return holdings


def _params(entry: EtfEntry, date: dt.date | None) -> dict:
    return {
        "APIType": "ETFAPI",
        "CompanyName": "YUANTAFUNDS",
        "PageName": f"/tradeInfo/pcf/{entry.etf_id}",
        "DeviceId": "null",
        "FuncId": "PCF/Daily",
        "AppName": "ETF",
        "Device": "3",
        "Platform": "ETF",
        "ticker": entry.etf_id,
        "ndate": date.strftime("%Y%m%d") if date else "",
    }


def _fetch_pcf(entry: EtfEntry, date: dt.date | None) -> dict:
    response = requests.get(
        _API_URL, headers=UA, params=_params(entry, date), timeout=30
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
