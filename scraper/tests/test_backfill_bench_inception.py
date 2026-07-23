import datetime as dt

import pytest

from scripts import backfill_bench_inception


def test_build_updates_covers_every_historical_metric_row_with_aligned_start():
    d1 = dt.date(2026, 5, 1)
    d2 = dt.date(2026, 7, 1)
    d3 = dt.date(2026, 7, 2)
    benchmark = {d1: 100.0, d2: 120.0, d3: 132.0}
    etf_series = {
        "A": {d2: 10.0, d3: 11.0},
        "B": {d3: 20.0},
    }

    updates = backfill_bench_inception.build_updates(
        [("A", d2), ("A", d3), ("B", d3)],
        benchmark,
        etf_series,
    )

    assert updates == [
        (pytest.approx(0.0), "A", d2),
        (pytest.approx(0.1), "A", d3),
        (pytest.approx(0.0), "B", d3),
    ]
