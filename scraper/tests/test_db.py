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
