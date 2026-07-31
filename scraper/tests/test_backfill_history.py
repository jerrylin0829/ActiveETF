import datetime as dt

from activeetf.backfill import backfill_targets, request_date_for

D = dt.date

# 2026-07-24(五)、07-27(一)：中間隔週末，用來擋掉日曆 ±1 day 的錯誤修法
_WEEK = [D(2026, 7, 23), D(2026, 7, 24), D(2026, 7, 27), D(2026, 7, 28)]


def test_only_dates_on_or_after_listing():
    targets = backfill_targets(
        trading_dates=[D(2026, 6, 1), D(2026, 6, 2), D(2026, 6, 3)],
        listing_dates={"00981A": D(2026, 6, 2)},
        existing=set(),
    )
    assert [date for _, date in targets] == [
        D(2026, 6, 2),
        D(2026, 6, 3),
    ]


def test_skips_dates_already_in_snapshot():
    targets = backfill_targets(
        trading_dates=[D(2026, 6, 1), D(2026, 6, 2)],
        listing_dates={"00981A": D(2026, 6, 1)},
        existing={("00981A", D(2026, 6, 1))},
    )
    assert targets == [("00981A", D(2026, 6, 2))]


def test_chronological_order_per_etf():
    targets = backfill_targets(
        trading_dates=[D(2026, 6, 3), D(2026, 6, 1), D(2026, 6, 2)],
        listing_dates={"00981A": D(2026, 6, 1)},
        existing=set(),
    )
    dates = [date for etf_id, date in targets if etf_id == "00981A"]
    assert dates == sorted(dates)


def test_zero_offset_requests_the_target_date_itself():
    assert request_date_for(_WEEK, D(2026, 7, 27), 0) == D(2026, 7, 27)


def test_positive_offset_crosses_the_weekend_instead_of_adding_one_day():
    # 統一／第一金／安聯：請求 D 拿到 D 的前一交易日，故目標 07-24 要請求 07-27
    assert request_date_for(_WEEK, D(2026, 7, 24), 1) == D(2026, 7, 27)


def test_negative_offset_crosses_the_weekend_instead_of_subtracting_one_day():
    # 元大：請求 D 拿到 D 的次一交易日，故目標 07-27 要請求 07-24
    assert request_date_for(_WEEK, D(2026, 7, 27), -1) == D(2026, 7, 24)


def test_offset_skips_market_holidays_present_as_calendar_gaps():
    # 交易日曆本身就沒有休市日，位移必須沿著日曆走而不是沿著日期走
    calendar = [D(2026, 2, 13), D(2026, 2, 23), D(2026, 2, 24)]
    assert request_date_for(calendar, D(2026, 2, 13), 1) == D(2026, 2, 23)
    assert request_date_for(calendar, D(2026, 2, 23), -1) == D(2026, 2, 13)


def test_returns_none_when_shifted_date_falls_outside_the_calendar():
    assert request_date_for(_WEEK, D(2026, 7, 28), 1) is None
    assert request_date_for(_WEEK, D(2026, 7, 23), -1) is None


def test_returns_none_when_target_is_not_a_trading_day():
    assert request_date_for(_WEEK, D(2026, 7, 25), 1) is None


def test_rotates_between_etfs_to_avoid_hammering_one_host():
    targets = backfill_targets(
        trading_dates=[D(2026, 6, 1), D(2026, 6, 2)],
        listing_dates={
            "00981A": D(2026, 6, 1),
            "00990A": D(2026, 6, 1),
        },
        existing=set(),
    )
    assert [etf_id for etf_id, _ in targets] == [
        "00981A",
        "00990A",
        "00981A",
        "00990A",
    ]
