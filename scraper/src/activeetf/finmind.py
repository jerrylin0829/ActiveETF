"""FinMind 行情 client。每日用量：market_close 1 次 + adj_prices 若干 + index 1 次，
遠低於免費層 600 次/時。TWSE OpenAPI 備援屬後續擴充（spec §9）。

還原價（adj_prices）改用 yfinance：FinMind 免費層 TaiwanStockPriceAdj 需
backer/sponsor 會員，不符合 $0/月營運目標（spec §2 2026-07-09 決策）。"""
import datetime as dt
import os
import requests
import yfinance as yf

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
    """單一標的還原價序列（報酬/勝率計算用）。依序試 .TW（上市）/.TWO（上櫃），
    兩者皆無資料則回傳空 list（比照海外持股：該檔個股層級指標從缺）。"""
    end_inclusive = (dt.date.fromisoformat(end) + dt.timedelta(days=1)).isoformat()
    for suffix in (".TW", ".TWO"):
        hist = yf.Ticker(f"{stock_id}{suffix}").history(
            start=start, end=end_inclusive, auto_adjust=True)
        if not hist.empty:
            return [{"stock_id": stock_id, "date": idx.strftime("%Y-%m-%d"),
                     "close": float(close)}
                    for idx, close in hist["Close"].items()]
    return []

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
