"""歷史回補的純邏輯：決定要抓哪些 (etf_id, date)。"""

import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass

from activeetf.adapters import base as adapter_base
from activeetf.models import Holding
from activeetf.registry import EtfEntry

WEIGHT_DECIMALS = 4  # holdings_snapshot.weight_pct 為 numeric(8,4)


@dataclass(frozen=True)
class RepairPlan:
    """既有快照補觀察部位的計畫；`safe` 為 False 時一列都不准寫。"""

    missing_observations: list[Holding]
    conflicts: list[str]
    unexpected_missing: list[str]

    @property
    def safe(self) -> bool:
        return not self.conflicts and not self.unexpected_missing


def plan_repair(
    existing: dict[str, Holding],
    upstream: dict[str, Holding],
) -> RepairPlan:
    """只補「DB 缺少且上游權重為 0」的列，且既有列必須與上游完全一致。

    這是 bounded append-only 修復：不 update、不 delete。既有列只要有一列對不上，
    或缺的列帶有實質權重，就不是「PR #19 之前丟棄觀察部位」這個已知缺口——
    停下來查，不可順手補。
    """
    conflicts = sorted(
        stock_id
        for stock_id, held in existing.items()
        if stock_id not in upstream
        or upstream[stock_id].shares != held.shares
        or round(upstream[stock_id].weight_pct, WEIGHT_DECIMALS)
        != round(held.weight_pct, WEIGHT_DECIMALS)
    )
    missing = [
        holding
        for stock_id, holding in upstream.items()
        if stock_id not in existing
    ]
    return RepairPlan(
        missing_observations=[h for h in missing if h.weight_pct == 0],
        conflicts=conflicts,
        unexpected_missing=sorted(
            h.stock_id for h in missing if h.weight_pct != 0
        ),
    )


def request_date_for(
    trading_dates: list[dt.date],
    target: dt.date,
    offset: int,
) -> dt.date | None:
    """把目標交易日換算成該 adapter 要送出的請求日。

    `offset` 的單位是**交易日**（不是日曆日）——上游的日期語意跟著市場走，
    用 `target ± 1 day` 會在週末與連假錯開。位移後超出日曆範圍時回 None，
    由呼叫端記錄並略過，不得猜一個日期送出去。
    """
    calendar = sorted(trading_dates)
    try:
        index = calendar.index(target)
    except ValueError:
        return None
    shifted = index + offset
    if not 0 <= shifted < len(calendar):
        return None
    return calendar[shifted]


def backfill_targets(
    trading_dates: list[dt.date],
    listing_dates: dict[str, dt.date],
    existing: set[tuple[str, dt.date]],
) -> list[tuple[str, dt.date]]:
    """依日期正序回傳待抓清單，同日內輪替 ETF。"""
    targets: list[tuple[str, dt.date]] = []
    for date in sorted(trading_dates):
        for etf_id in sorted(listing_dates):
            if date < listing_dates[etf_id]:
                continue
            if (etf_id, date) in existing:
                continue
            targets.append((etf_id, date))
    return targets


def discover_adapters(
    registry_entries: Iterable[EtfEntry],
) -> tuple[dict[str, tuple[EtfEntry, object]], list[str]]:
    """Split registry entries by the optional historical-fetch capability."""
    supported: dict[str, tuple[EtfEntry, object]] = {}
    skipped: list[str] = []
    for entry in registry_entries:
        if not entry.adapter:
            continue
        module = adapter_base.load(entry.adapter)
        if adapter_base.supports_history(module):
            supported[entry.etf_id] = (entry, module)
        else:
            skipped.append(f"{entry.etf_id}({entry.adapter})")
    return supported, skipped
