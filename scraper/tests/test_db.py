import os, datetime as dt
import pytest
from activeetf.models import Holding
from activeetf import db

pytestmark = pytest.mark.skipif(not os.environ.get("SUPABASE_DB_URL"),
                                reason="needs SUPABASE_DB_URL")

D = dt.date(2000, 1, 3)  # 用遠古日期避免污染真實資料；teardown 再刪

@pytest.fixture(autouse=True)
def _cleanup():
    yield
    with db.conn() as c:
        c.execute("delete from holdings_snapshot where trade_date = %s", (D,))
        c.execute("delete from scrape_log where trade_date = %s", (D,))
        c.execute("delete from etf where etf_id = '_TEST'")

def test_snapshot_roundtrip():
    with db.conn() as c:
        c.execute("insert into etf (etf_id, name, issuer) values ('_TEST','t','t')")
    db.write_snapshot("_TEST", D, [Holding("2330", 1000, 50.0)])
    snap = db.load_snapshot("_TEST", D)
    assert snap["2330"].shares == 1000
    assert db.latest_snapshot_date("_TEST", before=D) is None

def test_scrape_log_roundtrip():
    db.log_scrape("_TEST", D, "fail", "boom")
    assert db.scraped_ok("_TEST", D) is False


def test_sync_etf_is_idempotent_upsert():
    from activeetf.registry import EtfEntry
    e = EtfEntry("_TEST", "測試", "測投信", "tw", "http://x", "capital")
    db.sync_etf([e])
    db.sync_etf([EtfEntry("_TEST", "測試改名", "測投信", "tw", "http://y", "capital")])
    with db.conn() as c:
        row = c.execute("select name, pcf_url from etf where etf_id='_TEST'").fetchone()
    assert row == ("測試改名", "http://y")   # 第二次 upsert 覆蓋，不重複插入


def test_etf_metrics_has_benchmark_inception_column():
    with db.conn() as c:
        row = c.execute(
            """select data_type from information_schema.columns
               where table_schema='public' and table_name='etf_metrics'
                 and column_name='bench_0050_inception'"""
        ).fetchone()
    assert row == ("numeric",)
