"""每日主流程。18:30 主場與 21:30 補抓場跑同一支：scraped_ok 者跳過即天然冪等。"""
import datetime as dt
import time, traceback
from activeetf import db, finmind, metrics
from activeetf.adapters import base as adapter_base
from activeetf.registry import entries, EtfEntry
from activeetf.validate import validate, ValidationError
from activeetf.diff import diff_snapshots

class Deps:
    """正式依賴。測試以 FakeDeps 注入替代（見 test_pipeline.py）。"""
    scraped_ok = staticmethod(db.scraped_ok)
    snapshot_count = staticmethod(db.snapshot_count)
    latest_snapshot_date = staticmethod(db.latest_snapshot_date)
    load_snapshot = staticmethod(db.load_snapshot)
    write_snapshot = staticmethod(db.write_snapshot)
    write_changes = staticmethod(db.write_changes)
    known_stock_ids = staticmethod(db.known_stock_ids)
    log_scrape = staticmethod(db.log_scrape)
    @staticmethod
    def fetch(entry: EtfEntry):
        return adapter_base.load(entry.adapter).fetch(entry)

def scrape_one(entry: EtfEntry, today: dt.date, deps) -> None:
    if deps.scraped_ok(entry.etf_id, today):
        return
    try:
        if not entry.adapter or not entry.pcf_url:
            raise RuntimeError("adapter not implemented yet")
        holdings = deps.fetch(entry)
        prev_date = deps.latest_snapshot_date(entry.etf_id, before=today)
        prev_count = deps.snapshot_count(entry.etf_id, prev_date) if prev_date else None
        validate(holdings, prev_count, deps.known_stock_ids(), entry.universe)
        deps.write_snapshot(entry.etf_id, today, holdings)
        if prev_date is not None:
            prev = deps.load_snapshot(entry.etf_id, prev_date)
            curr = {h.stock_id: h for h in holdings}
            deps.write_changes(entry.etf_id, today, diff_snapshots(prev, curr))
        deps.log_scrape(entry.etf_id, today, "ok")
    except Exception as ex:   # 單檔失敗不擴散（spec §5 隔離）；ValidationError 也走這裡
        deps.log_scrape(entry.etf_id, today, "fail",
                        f"{type(ex).__name__}: {ex}\n{traceback.format_exc()[-800:]}")

def refresh_stock_info() -> None:
    rows = [(r["stock_id"], r["stock_name"], r.get("industry_category"), r.get("type"))
            for r in finmind.stock_info()]
    db.upsert_stock_info(rows)

def main() -> int:
    today = dt.date.today()
    if not finmind.is_trading_day(str(today)):
        print(f"{today} 非交易日，跳過")
        return 0
    db.sync_etf(entries())   # 先播種 etf 母表，holdings_snapshot 外鍵才有對應列
    refresh_stock_info()
    deps = Deps()
    for entry in entries():
        scrape_one(entry, today, deps)
        time.sleep(1.5)
    metrics.compute_all(today)   # 還原價/指數由 metrics 按需向 yfinance/FinMind 拉並快取
    db.refresh_daily_aggregates(today)   # spec 2026-07-16 §3.3: aggregates after snapshots+events
    # 只把「已實作的 adapter」納入成敗判定：未實作者本就會 log fail，不該稀釋全滅判斷。
    # 注意：部分失敗目前只落在 scrape_log，Dashboard 黃條尚未實作，故僅全滅時讓 job 紅。
    implemented = [e for e in entries() if e.adapter and e.pcf_url]
    failed = [e.etf_id for e in implemented if not db.scraped_ok(e.etf_id, today)]
    print(f"完成。已實作 {len(implemented)} 檔，失敗 {len(failed)}: {failed}")
    return 1 if implemented and len(failed) == len(implemented) else 0   # 已實作者全滅才讓 job 紅

if __name__ == "__main__":
    raise SystemExit(main())
