import datetime as dt
from activeetf.models import Holding
from activeetf import pipeline

class FakeDeps:
    """pipeline 的所有外部依賴收在一個可注入的物件，測試用 fake 取代。"""
    def __init__(self):
        self.snapshots, self.changes, self.logs = {}, {}, []
        self.known = {"2330", "2317"}
        self.fetch_results = {}
    # --- db ---
    def scraped_ok(self, etf_id, d): return (etf_id, d) in self.snapshots
    def snapshot_count(self, etf_id, d): return len(self.snapshots.get((etf_id, d), [])) or None
    def latest_snapshot_date(self, etf_id, before):
        ds = [d for (e, d) in self.snapshots if e == etf_id and d < before]
        return max(ds) if ds else None
    def load_snapshot(self, etf_id, d):
        return {h.stock_id: h for h in self.snapshots.get((etf_id, d), [])}
    def write_snapshot(self, etf_id, d, hs): self.snapshots[(etf_id, d)] = hs
    def write_changes(self, etf_id, d, cs): self.changes[(etf_id, d)] = cs
    def known_stock_ids(self): return self.known
    def log_scrape(self, etf_id, d, status, error=None): self.logs.append((etf_id, d, status))
    # --- adapter ---
    def fetch(self, entry):
        r = self.fetch_results[entry.etf_id]
        if isinstance(r, Exception): raise r
        return r

D1, D2 = dt.date(2026, 7, 2), dt.date(2026, 7, 3)
GOOD = [Holding("2330", 1000, 60.0), Holding("2317", 500, 30.0)]

def _entry(etf_id="00992A"):
    from activeetf.registry import EtfEntry
    return EtfEntry(etf_id, "測試", "群益", "tw", "http://x", "capital")

def test_happy_path_writes_snapshot_and_diff():
    deps = FakeDeps()
    deps.snapshots[("00992A", D1)] = [Holding("2330", 1000, 62.0), Holding("2454", 300, 28.0)]
    deps.known = {"2330", "2317", "2454"}
    deps.fetch_results["00992A"] = GOOD
    pipeline.scrape_one(_entry(), D2, deps)
    assert ("00992A", D2) in deps.snapshots
    types = {c.stock_id: c.change_type for c in deps.changes[("00992A", D2)]}
    assert types["2317"] == "NEW" and types["2454"] == "EXIT"
    assert deps.logs[-1][2] == "ok"

def test_validation_failure_writes_nothing():
    deps = FakeDeps()
    deps.fetch_results["00992A"] = [Holding("2330", 1000, 10.0)]   # 權重和 10 < 70
    pipeline.scrape_one(_entry(), D2, deps)
    assert ("00992A", D2) not in deps.snapshots
    assert deps.logs[-1][2] == "fail"

def test_fetch_exception_is_isolated():
    deps = FakeDeps()
    deps.fetch_results["00992A"] = RuntimeError("網站掛了")
    pipeline.scrape_one(_entry(), D2, deps)   # 不往外丟
    assert deps.logs[-1][2] == "fail"

def test_already_scraped_skips():
    deps = FakeDeps()
    deps.snapshots[("00992A", D2)] = GOOD
    pipeline.scrape_one(_entry(), D2, deps)
    assert deps.logs == []   # 21:30 補抓場對已成功者直接略過


def test_refresh_daily_outputs_caches_holding_closes_before_aggregate(monkeypatch):
    calls = []
    monkeypatch.setattr(
        pipeline.metrics, "compute_all", lambda today: calls.append(("metrics", today))
    )
    monkeypatch.setattr(
        pipeline.metrics,
        "cache_daily_holding_closes",
        lambda today: calls.append(("closes", today)),
        raising=False,
    )
    monkeypatch.setattr(
        pipeline.db,
        "refresh_daily_aggregates",
        lambda today: calls.append(("aggregates", today)),
    )

    monkeypatch.setattr(
        pipeline.metrics,
        "refresh_open_positions",
        lambda today: calls.append(("open_positions", today)),
        raising=False,
    )

    pipeline.refresh_daily_outputs(D2)

    assert calls == [
        ("metrics", D2),
        ("closes", D2),
        ("aggregates", D2),
        ("open_positions", D2),
    ]
