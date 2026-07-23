import os

import pytest

from activeetf import db

pytestmark = pytest.mark.skipif(
    not os.environ.get("SUPABASE_DB_URL"),
    reason="needs SUPABASE_DB_URL",
)


def test_etf_metrics_has_benchmark_inception_column():
    with db.conn() as c:
        row = c.execute(
            """select data_type from information_schema.columns
               where table_schema='public' and table_name='etf_metrics'
                 and column_name='bench_0050_inception'"""
        ).fetchone()
    assert row == ("numeric",)
