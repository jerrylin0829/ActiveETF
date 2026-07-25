"""統一投信 PCF adapter."""
import datetime as dt
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_PCF_PAGE = "https://www.ezmoney.com.tw/ETF/Transaction/PCF"
_PCF_API = "https://www.ezmoney.com.tw/ETF/Transaction/GetPCF"
_FUND_CODES = {
    "00403A": "63YTW",
    "00981A": "49YTW",
    "00988A": "61YTW",
}


def parse(payload: dict) -> list[Holding]:
    holdings: list[Holding] = []
    for asset in payload.get("asset", []):
        if asset.get("AssetCode") != "ST":
            continue
        for row in asset.get("Details") or []:
            shares = int(float(row["Share"]))
            weight = float(row["NavRate"])
            if shares > 0:
                holdings.append(
                    Holding(
                        stock_id=str(row["DetailCode"]).strip(),
                        shares=shares,
                        weight_pct=weight,
                    )
                )
    return holdings


def _roc(date: dt.date) -> str:
    return f"{date.year - 1911:03d}/{date.month:02d}/{date.day:02d}"


def _roc_today() -> str:
    return _roc(datetime.now(ZoneInfo("Asia/Taipei")).date())


def _fetch_pcf(entry: EtfEntry, date: dt.date | None) -> list[Holding]:
    session = requests.Session()
    response = session.get(
        _PCF_PAGE, headers=UA, timeout=30, allow_redirects=False
    )
    if response.is_redirect:
        response = session.get(
            _PCF_PAGE, headers=UA, timeout=30, allow_redirects=False
        )
    response.raise_for_status()

    response = session.post(
        _PCF_API,
        json={
            "fundCode": _FUND_CODES[entry.etf_id],
            "date": _roc(date) if date else _roc_today(),
            "specificDate": date is not None,
        },
        headers=UA,
        timeout=30,
    )
    response.raise_for_status()
    return parse(response.json())


def fetch(entry: EtfEntry) -> list[Holding]:
    return _fetch_pcf(entry, None)


def fetch_at(entry: EtfEntry, date: dt.date) -> list[Holding]:
    return _fetch_pcf(entry, date)
