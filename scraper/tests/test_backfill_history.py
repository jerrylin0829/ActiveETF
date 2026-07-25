import datetime as dt

from activeetf.backfill import backfill_targets

D = dt.date


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
