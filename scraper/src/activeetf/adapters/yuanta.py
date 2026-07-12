"""元大投信 PCF adapter."""
import requests

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_API_URL = "https://etfapi.yuantaetfs.com/ectranslation/api/bridge"


def parse(payload: dict) -> list[Holding]:
    holdings: list[Holding] = []
    for row in payload.get("FundWeights", {}).get("StockWeights", []):
        shares = int(float(row["qty"]))
        weight = float(row["weights"])
        if shares > 0 and weight > 0:
            holdings.append(
                Holding(
                    stock_id=str(row["code"]).strip(),
                    shares=shares,
                    weight_pct=weight,
                )
            )
    return holdings


def fetch(entry: EtfEntry) -> list[Holding]:
    params = {
        "APIType": "ETFAPI",
        "CompanyName": "YUANTAFUNDS",
        "PageName": f"/tradeInfo/pcf/{entry.etf_id}",
        "DeviceId": "null",
        "FuncId": "PCF/Daily",
        "AppName": "ETF",
        "Device": "3",
        "Platform": "ETF",
        "ticker": entry.etf_id,
        "ndate": "",
    }
    response = requests.get(_API_URL, headers=UA, params=params, timeout=30)
    response.raise_for_status()
    return parse(response.json())
