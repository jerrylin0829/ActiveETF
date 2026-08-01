"""統一投信 PCF adapter."""
import datetime as dt
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from activeetf.adapters import base
from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_PCF_PAGE = "https://www.ezmoney.com.tw/ETF/Transaction/PCF"
_PCF_API = "https://www.ezmoney.com.tw/ETF/Transaction/GetPCF"
# 請求 D 拿到的是 D 的前一交易日資料，故目標交易日 T 要請求 T 的次一交易日
HISTORY_REQUEST_OFFSET = 1
# 全球型的 00988A 又多一個交易日的時差（2026-07-31 實測，台股型的兩檔為 +1）
HISTORY_REQUEST_OFFSETS = {"00988A": 2}
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


def source_date(payload: dict) -> dt.date | None:
    """上游自報的資料日 = `pcf[].TranDate`。

    `PostDate` 是該份 PCF「適用的交易日」，比資料日晚一個交易日——用 PostDate
    核對會剛好把錯位的資料判成正確。
    """
    return base.unique_upstream_date(
        row.get("TranDate") for row in payload.get("pcf") or []
    )


def _fetch_pcf(entry: EtfEntry, date: dt.date | None) -> dict:
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
    return response.json()


def fetch(entry: EtfEntry) -> list[Holding]:
    return parse(_fetch_pcf(entry, None))


def fetch_at(
    entry: EtfEntry, date: dt.date
) -> tuple[list[Holding], dt.date | None]:
    payload = _fetch_pcf(entry, date)
    return parse(payload), source_date(payload)
