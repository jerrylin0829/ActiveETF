"""歷史回補的純邏輯：決定要抓哪些 (etf_id, date)。"""

import datetime as dt


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
