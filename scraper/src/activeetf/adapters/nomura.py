"""野村投信 PCF adapter.

Official ETFWEB is an Angular shell. The complete PCF data is served by:
POST /API/ETFAPI/api/Fund/GetFundTradeInfoDate
POST /API/ETFAPI/api/Fund/GetFundTradeInfo
"""
import requests

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_API_BASE = "https://www.nomurafunds.com.tw/API/ETFAPI/api"


def parse(payload: dict) -> list[Holding]:
    stocks = payload["Entries"]["Stocks"]
    holdings: list[Holding] = []
    for row in stocks:
        stock_id = str(row["CStockCode"]).strip()
        shares = int(row["CQuantity"])
        weight_pct = float(row["CWeightsPct"])
        if not stock_id or shares <= 0:
            continue
        holdings.append(Holding(stock_id=stock_id, shares=shares, weight_pct=weight_pct))
    return holdings


def _request_body(entry: EtfEntry, date: str = "") -> dict:
    return {"Type": 1, "Keyword": "", "FundNo": entry.etf_id, "Date": date}


def _post(endpoint: str, body: dict) -> dict:
    r = requests.post(
        f"{_API_BASE}/{endpoint}",
        json=body,
        headers={**UA, "Accept": "application/json", "Content-Type": "application/json"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def fetch(entry: EtfEntry) -> list[Holding]:
    latest = _post("Fund/GetFundTradeInfoDate", _request_body(entry))
    latest_date = latest["Entries"]["LatestDate"]
    payload = _post("Fund/GetFundTradeInfo", _request_body(entry, latest_date))
    return parse(payload)
