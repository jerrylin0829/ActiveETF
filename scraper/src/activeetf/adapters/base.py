"""Adapter 統一介面：fetch(entry) -> list[Holding]。
每家投信一個模組，模組內只管「怎麼把該家格式轉成 Holding」；
重試、驗證、入庫都在 pipeline，adapter 保持純粹。"""
import datetime as dt
import importlib
import re
from collections.abc import Iterable
from typing import Protocol
from zoneinfo import ZoneInfo

from activeetf.models import Holding
from activeetf.registry import EtfEntry

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
TAIPEI = ZoneInfo("Asia/Taipei")

_ASPNET_EPOCH = re.compile(r"^/Date\((-?\d+)")
_YMD = re.compile(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})")


class Adapter(Protocol):
    def fetch(self, entry: EtfEntry) -> list[Holding]: ...


class HistoricalAdapter(Protocol):
    """可選能力：支援指定歷史日期抓取。

    回傳 `(holdings, source_date)`——`source_date` 是**上游自報的資料日**，
    由回補腳本核對是否等於要寫入的 trade_date。只回持股會讓日期錯位無法察覺
    （2026-07-31 實測：六支有四支的請求日不等於資料日）。
    """

    def fetch_at(
        self, entry: EtfEntry, date: dt.date
    ) -> tuple[list[Holding], dt.date | None]: ...


def load(name: str) -> Adapter:
    return importlib.import_module(f"activeetf.adapters.{name}")


def supports_history(module: object) -> bool:
    """該 adapter 是否能抓指定歷史日期。"""
    return callable(getattr(module, "fetch_at", None))


def history_request_offset(module: object, etf_id: str | None = None) -> int:
    """目標交易日 → 請求日的位移，單位為**交易日**（預設 0 = 請求日即資料日）。

    容許以 `HISTORY_REQUEST_OFFSETS` 逐檔覆寫。（注意：統一的全球型 00988A 差在
    「期望資料日」而非請求位移——見 `history_source_offset`。）
    """
    per_etf = getattr(module, "HISTORY_REQUEST_OFFSETS", {})
    if etf_id is not None and etf_id in per_etf:
        return per_etf[etf_id]
    return getattr(module, "HISTORY_REQUEST_OFFSET", 0)


def history_source_offset(module: object, etf_id: str | None = None) -> int:
    """該 ETF 的 `trade_date` **應該**對應到哪一個上游資料日，單位為交易日。

    預設 0（資料日等於 trade_date）。少數基金的每日路徑本來就存著前一交易日的
    資料（實測：統一的全球型 00988A），斷言必須照每日路徑的語意走，否則回補
    出來的歷史會與既有快照差一天。
    """
    per_etf = getattr(module, "HISTORY_SOURCE_OFFSETS", {})
    if etf_id is not None and etf_id in per_etf:
        return per_etf[etf_id]
    return getattr(module, "HISTORY_SOURCE_OFFSET", 0)


def unique_upstream_date(values: Iterable[object]) -> dt.date | None:
    """多列都帶資料日時要求一致；不一致或解不出來一律回 None，不猜。

    空值（`None`／空字串）視為「這一列沒有宣告日期」而略過；**有值卻解析不出來
    代表上游格式變了**，不能靠其他列蒙混過關，直接回 None。
    """
    parsed: set[dt.date] = set()
    for value in values:
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        date = parse_upstream_date(value)
        if date is None:
            return None
        parsed.add(date)
    return parsed.pop() if len(parsed) == 1 else None


def parse_upstream_date(raw: object) -> dt.date | None:
    """解析各家自報的資料日；無法解析一律回 None，不猜。"""
    if not isinstance(raw, str):
        return None
    epoch = _ASPNET_EPOCH.match(raw)
    if epoch:
        # ASP.NET `/Date(ms)/` 為 UTC epoch，台北午夜用 UTC 解會早一天
        return dt.datetime.fromtimestamp(int(epoch.group(1)) / 1000, TAIPEI).date()
    ymd = _YMD.search(raw)
    if not ymd:
        return None
    year, month, day = (int(part) for part in ymd.groups())
    try:
        return dt.date(year, month, day)
    except ValueError:
        return None
