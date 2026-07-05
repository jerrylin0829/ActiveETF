"""FinMind 行情 client。每日用量：market_close 1 次 + adj_prices 若干 + index 1 次，
遠低於免費層 600 次/時。TWSE OpenAPI 備援屬後續擴充（spec §9）。"""
import os
import requests

BASE = "https://api.finmindtrade.com/api/v4/data"
TAIEX_TRI = "TAIEX_TRI"   # 我們在 stock_price 表中使用的加權報酬指數代號

def _get(params: dict) -> list[dict]:
    headers = {"Authorization": f"Bearer {os.environ['FINMIND_TOKEN']}"}
    r = requests.get(BASE, params=params, headers=headers, timeout=60)
    r.raise_for_status()
    body = r.json()
    if body.get("status") != 200:
        raise RuntimeError(f"FinMind error: {body.get('msg')}")
    return body["data"]

def market_close(date: str) -> list[dict]:
    """當日全市場收盤價（單次呼叫）。"""
    return _get({"dataset": "TaiwanStockPrice", "start_date": date, "end_date": date})

def adj_prices(stock_id: str, start: str, end: str) -> list[dict]:
    """單一標的還原價序列（報酬/勝率計算用）。"""
    return _get({"dataset": "TaiwanStockPriceAdj", "data_id": stock_id,
                 "start_date": start, "end_date": end})

def total_return_index(start: str, end: str) -> list[dict]:
    """發行量加權股價報酬指數（含息）。data_id=TAIEX。"""
    return _get({"dataset": "TaiwanStockTotalReturnIndex", "data_id": "TAIEX",
                 "start_date": start, "end_date": end})

def stock_info() -> list[dict]:
    return _get({"dataset": "TaiwanStockInfo"})

def is_trading_day(date: str) -> bool:
    """以 0050 當日是否有價判定交易日。"""
    return len(_get({"dataset": "TaiwanStockPrice", "data_id": "0050",
                     "start_date": date, "end_date": date})) > 0
