"""Supabase 持久層。此為 Task 7 之前的暫時 stub——正式實作見 plan Task 7。"""


def scraped_ok(etf_id, date):
    raise NotImplementedError("Task 7 pending")


def snapshot_count(etf_id, date):
    raise NotImplementedError("Task 7 pending")


def latest_snapshot_date(etf_id, before):
    raise NotImplementedError("Task 7 pending")


def load_snapshot(etf_id, date):
    raise NotImplementedError("Task 7 pending")


def write_snapshot(etf_id, date, holdings):
    raise NotImplementedError("Task 7 pending")


def write_changes(etf_id, date, changes):
    raise NotImplementedError("Task 7 pending")


def known_stock_ids():
    raise NotImplementedError("Task 7 pending")


def log_scrape(etf_id, date, status, error=None):
    raise NotImplementedError("Task 7 pending")


def upsert_prices(rows):
    raise NotImplementedError("Task 7 pending")


def upsert_stock_info(rows):
    raise NotImplementedError("Task 7 pending")


def conn():
    raise NotImplementedError("Task 7 pending")
