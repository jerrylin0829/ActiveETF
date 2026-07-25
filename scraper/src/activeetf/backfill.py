"""歷史回補的純邏輯：決定要抓哪些 (etf_id, date)。"""

import datetime as dt


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
