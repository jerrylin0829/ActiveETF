"""聯博投信 PCF adapter."""
import requests

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_API_BASE = (
    "https://webapi.alliancebernstein.com/v2/funds/tw/zh-tw/investor"
)
_ISINS = {"00404A": "TW00000404A5"}


def parse(payload: dict) -> list[Holding]:
    holdings: list[Holding] = []
    for section in payload.get("domesticHoldings", []):
        if section.get("holdingCategory") != "holdings-section-equity":
            continue
        for row in section.get("holdings", []):
            shares = int(float(row["holdingShares"]))
            weight = float(row["holdingPerc"])
            if shares > 0 and weight > 0:
                holdings.append(
                    Holding(
                        stock_id=str(row["holdingCode"]).strip(),
                        shares=shares,
                        weight_pct=weight,
                    )
                )
    return holdings


def fetch(entry: EtfEntry) -> list[Holding]:
    url = f"{_API_BASE}/{_ISINS[entry.etf_id]}/holdings"
    response = requests.get(url, headers=UA, timeout=30)
    response.raise_for_status()
    return parse(response.json())
