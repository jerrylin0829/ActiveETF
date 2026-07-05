"""群益投信 PCF。

呼叫後端 JSON API：POST /CFWeb/api/etf/buyback，回傳
  {"code":200, "data": {"stocks": [{stocNo, weightRound, share, ...}, ...], ...}}

selector / 欄位名稱以 fixture 實測為準；API 結構改版時本測試會先炸，
照 Task 10 流程重錄 fixture（capital_00992A.json）。
"""
import requests

from activeetf.adapters.base import UA
from activeetf.models import Holding
from activeetf.registry import EtfEntry

_API_BASE = "https://www.capitalfund.com.tw/CFWeb"


def parse(payload: dict) -> list[Holding]:
    """payload: parsed JSON response body from POST /CFWeb/api/etf/buyback.

    Returns real stock holdings only; bonds / futures / assets are excluded.
    """
    stocks = payload["data"]["stocks"]
    holdings: list[Holding] = []
    for row in stocks:
        stock_id: str = str(row["stocNo"]).strip()
        if not stock_id:
            continue
        # Use precise weight (e.g. 7.7158) rather than rounded display value (7.72)
        # so that diff.py can detect sub-0.05pp changes correctly.
        weight_pct: float = float(row["weight"])
        # share field is a float (e.g. 1406000.0) — cast to int
        shares: int = int(row["share"])
        if shares <= 0:
            continue
        holdings.append(Holding(stock_id=stock_id, shares=shares, weight_pct=weight_pct))
    return holdings


def fetch(entry: EtfEntry) -> list[Holding]:
    """Fetch PCF from 群益 API using the fund's internal numeric ID.

    The fund's numeric ID is derived from pcf_url: .../detail/<id>/portfolio.
    """
    if entry.pcf_url is None:
        raise ValueError(f"pcf_url is None for {entry.etf_id} — registry not updated yet")
    # Extract numeric fund ID from URL, e.g. ".../detail/500/portfolio" -> 500
    fund_id = int(entry.pcf_url.rstrip("/").split("/")[-2])
    r = requests.post(
        f"{_API_BASE}/api/etf/buyback",
        json={"fundId": fund_id},
        headers={**UA, "Accept": "application/json", "Referer": entry.pcf_url},
        timeout=30,
    )
    r.raise_for_status()
    return parse(r.json())
