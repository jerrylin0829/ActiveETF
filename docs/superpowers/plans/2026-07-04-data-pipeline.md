# 主動式 ETF 資料管線 Implementation Plan（Plan A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每日自動抓取全部 A 結尾主動式 ETF 的 PCF 持股，入庫 Supabase，計算異動事件與指標，跑在 GitHub Actions 上（$0/月）。

**Architecture:** Python 爬蟲（每家投信一個 adapter）→ 三道驗證 → Supabase Postgres（append-only 快照 + 事件 + 指標快取）。行情用 FinMind。Dashboard 屬 Plan B，不在本計畫。

**Tech Stack:** Python 3.12 + uv、requests、beautifulsoup4、psycopg（v3）、pytest、GitHub Actions、Supabase Postgres。

**設計事實來源:** `docs/superpowers/specs/2026-07-04-active-etf-tracker-design.md`（下稱 spec）。本計畫任何規則與 spec 衝突時以 spec 為準。

**前置條件（人工，開始前完成）:**
1. 建 Supabase 專案，取得 Database URL（Settings → Database → Connection string, direct）
2. 本機 `export SUPABASE_DB_URL="postgresql://..."`、`export FINMIND_TOKEN="..."`
3. GitHub repo 建立並推上（公開），Settings → Secrets 加 `SUPABASE_DB_URL`、`FINMIND_TOKEN`

**檔案結構（全計畫產出）:**

```
scraper/
├── pyproject.toml
├── migrations/001_schema.sql
├── src/activeetf/
│   ├── __init__.py
│   ├── models.py        # Holding / Change dataclasses
│   ├── registry.py      # ETF ↔ adapter ↔ PCF URL 對照
│   ├── validate.py      # 三道驗證
│   ├── diff.py          # 快照 diff → 異動事件
│   ├── finmind.py       # 行情 client
│   ├── db.py            # Supabase 讀寫（唯一碰 DB 的模組）
│   ├── metrics.py       # 報酬 / 勝率 / 風格指標
│   ├── pipeline.py      # 每日主流程
│   └── adapters/
│       ├── base.py
│       └── capital.py   # 群益（首個 adapter，範本）
├── scripts/
│   ├── probe.py         # 全投信官網探測（IP 封鎖偵察）
│   └── backfill.py      # 一次性股價回補
└── tests/
    ├── fixtures/        # 錄下的真實 PCF 頁面
    └── test_*.py
.github/workflows/daily.yml
```

---

### Task 1: 專案 scaffold ✅ 完成（commit db7b8c7）

**Files:** Create: `scraper/pyproject.toml`, `scraper/src/activeetf/__init__.py`, `scraper/tests/__init__.py`

- [x] **Step 1: 建立 uv 專案**

```bash
cd /Users/jerrylin/ActiveETF && mkdir -p scraper && cd scraper
uv init --lib --name activeetf --python 3.12
uv add requests beautifulsoup4 psycopg[binary] lxml
uv add --dev pytest responses
mkdir -p src/activeetf/adapters scripts tests/fixtures migrations
touch src/activeetf/adapters/__init__.py tests/__init__.py
```

- [x] **Step 2: 驗證測試環境**

Run: `cd scraper && uv run pytest --collect-only`
Expected: `no tests ran`（無錯誤即可）

- [x] **Step 3: Commit**

```bash
git add scraper && git commit -m "feat: scraper 專案 scaffold（uv + pytest）"
```

---

### Task 2: 資料庫 schema ⚠️ migration 已寫入，Supabase 套用待 `SUPABASE_DB_URL`

**Files:** Create: `scraper/migrations/001_schema.sql`

- [x] **Step 1: 寫 migration**

```sql
-- 001_schema.sql — spec §4
create table etf (
  etf_id      text primary key,
  name        text not null,
  issuer      text not null,
  listed_date date,
  pcf_url     text,
  universe    text not null default 'tw' check (universe in ('tw','global'))
);

create table holdings_snapshot (          -- append-only 事實來源
  etf_id     text not null references etf,
  trade_date date not null,
  stock_id   text not null,
  shares     bigint not null,
  weight_pct numeric(8,4) not null,
  primary key (etf_id, trade_date, stock_id)
);

create table holding_change (
  etf_id           text not null references etf,
  trade_date       date not null,
  stock_id         text not null,
  change_type      text not null check (change_type in ('NEW','ADD','TRIM','EXIT')),
  shares_delta     bigint not null,
  weight_delta_pct numeric(8,4) not null,
  primary key (etf_id, trade_date, stock_id)
);

create table stock_info (
  stock_id text primary key,
  name     text not null,
  industry text,
  market   text
);

create table stock_price (
  stock_id   text not null,
  trade_date date not null,
  close      numeric(14,4),
  adj_close  numeric(14,4),
  primary key (stock_id, trade_date)
);

create table etf_metrics (
  etf_id                text not null references etf,
  trade_date            date not null,
  ret_1m numeric, ret_3m numeric, ret_6m numeric, ret_1y numeric, ret_inception numeric,
  bench_0050_1m numeric, bench_0050_3m numeric, bench_0050_6m numeric, bench_0050_1y numeric,
  timing_wins int, timing_months int,
  picking_realized_wins int, picking_realized_total int,
  picking_open_wins int, picking_open_total int,
  median_holding_days numeric,
  weekly_turnover_pct numeric,
  primary key (etf_id, trade_date)
);

create table scrape_log (
  id         bigint generated always as identity primary key,
  etf_id     text not null,
  trade_date date not null,
  run_at     timestamptz not null default now(),
  status     text not null check (status in ('ok','fail')),
  error      text
);
create index scrape_log_lookup on scrape_log (etf_id, trade_date, status);

-- RLS：匿名唯讀（Dashboard 用 anon key），寫入走 direct connection / service key
do $$ declare t text;
begin
  foreach t in array array['etf','holdings_snapshot','holding_change','stock_info','stock_price','etf_metrics','scrape_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_read on %I for select using (true)', t, t);
  end loop;
end $$;
```

- [ ] **Step 2: 套用到 Supabase 並驗證** — 待 `SUPABASE_DB_URL`

```bash
psql "$SUPABASE_DB_URL" -f scraper/migrations/001_schema.sql
psql "$SUPABASE_DB_URL" -c "\dt"   # 應列出 7 張表
```

- [x] **Step 3: Commit**

```bash
git add scraper/migrations && git commit -m "feat: DB schema（7 表 + RLS 匿名唯讀）"
```

---

### Task 3: models ✅ 完成（commit ada443d）

**Files:** Create: `scraper/src/activeetf/models.py`, Test: `scraper/tests/test_models.py`

- [x] **Step 1: 失敗測試**

```python
# tests/test_models.py
from activeetf.models import Holding

def test_holding_is_frozen_value_object():
    h = Holding(stock_id="2330", shares=1000, weight_pct=8.5)
    assert h.stock_id == "2330"
    try:
        h.shares = 1  # type: ignore
        assert False, "should be frozen"
    except AttributeError:
        pass
```

- [x] **Step 2: 跑測試確認失敗**

Run: `uv run pytest tests/test_models.py -v` → Expected: FAIL（ModuleNotFoundError）

- [x] **Step 3: 實作**

```python
# src/activeetf/models.py
from dataclasses import dataclass

@dataclass(frozen=True)
class Holding:
    stock_id: str
    shares: int
    weight_pct: float

@dataclass(frozen=True)
class Change:
    stock_id: str
    change_type: str  # NEW / ADD / TRIM / EXIT
    shares_delta: int
    weight_delta_pct: float
```

- [x] **Step 4: 跑測試確認通過** → `uv run pytest tests/test_models.py -v` → PASS
- [x] **Step 5: Commit** → `git add -A && git commit -m "feat: Holding/Change value objects"`

---

### Task 4: validate — 三道驗證（spec §5） ✅ 完成（commit d548109）

**Files:** Create: `scraper/src/activeetf/validate.py`, Test: `scraper/tests/test_validate.py`

- [x] **Step 1: 失敗測試**

```python
# tests/test_validate.py
import pytest
from activeetf.models import Holding
from activeetf.validate import validate, ValidationError

KNOWN = {"2330", "2317", "2454"}

def _h(sid="2330", w=30.0, shares=1000):
    return Holding(stock_id=sid, shares=shares, weight_pct=w)

def test_passes_normal_holdings():
    hs = [_h("2330", 40), _h("2317", 30), _h("2454", 25)]
    validate(hs, prev_count=3, known_ids=KNOWN, universe="tw")  # 不丟例外

def test_rejects_empty():
    with pytest.raises(ValidationError):
        validate([], prev_count=3, known_ids=KNOWN, universe="tw")

def test_rejects_weight_sum_out_of_range():
    with pytest.raises(ValidationError, match="weight sum"):
        validate([_h("2330", 30)], prev_count=1, known_ids=KNOWN, universe="tw")   # 30 < 70
    with pytest.raises(ValidationError, match="weight sum"):
        validate([_h("2330", 60), _h("2317", 60)], prev_count=2, known_ids=KNOWN, universe="tw")  # 120 > 101

def test_rejects_count_collapse():
    hs = [_h("2330", 80)]
    with pytest.raises(ValidationError, match="count"):
        validate(hs, prev_count=80, known_ids=KNOWN, universe="tw")  # 80 筆 → 1 筆

def test_first_day_no_prev_count_ok():
    validate([_h("2330", 80)], prev_count=None, known_ids=KNOWN, universe="tw")

def test_rejects_unknown_stock_id_for_tw():
    with pytest.raises(ValidationError, match="unknown"):
        validate([_h("9999", 80)], prev_count=None, known_ids=KNOWN, universe="tw")

def test_global_universe_skips_id_check():
    validate([_h("NVDA", 80)], prev_count=None, known_ids=KNOWN, universe="global")
```

- [x] **Step 2: 確認失敗** → `uv run pytest tests/test_validate.py -v` → FAIL
- [x] **Step 3: 實作**

```python
# src/activeetf/validate.py
"""入庫前三道驗證（spec §5）。任一不過 = 整檔不寫入。錯資料比缺資料危險。"""
from activeetf.models import Holding

WEIGHT_SUM_MIN, WEIGHT_SUM_MAX = 70.0, 101.0   # 現金部位會吃掉一些權重
COUNT_COLLAPSE_RATIO = 0.5                      # 筆數 < 前日一半 = 解析到一半

class ValidationError(Exception):
    pass

def validate(holdings: list[Holding], prev_count: int | None,
             known_ids: set[str], universe: str) -> None:
    if not holdings:
        raise ValidationError("empty holdings")
    total = sum(h.weight_pct for h in holdings)
    if not (WEIGHT_SUM_MIN <= total <= WEIGHT_SUM_MAX):
        raise ValidationError(f"weight sum {total:.2f} outside [{WEIGHT_SUM_MIN},{WEIGHT_SUM_MAX}]")
    if prev_count is not None and len(holdings) < prev_count * COUNT_COLLAPSE_RATIO:
        raise ValidationError(f"count collapse: {len(holdings)} vs prev {prev_count}")
    if universe == "tw":
        unknown = sorted(h.stock_id for h in holdings if h.stock_id not in known_ids)
        if unknown:
            raise ValidationError(f"unknown stock ids: {unknown[:5]}")
```

- [x] **Step 4: 確認通過** → `uv run pytest tests/test_validate.py -v` → PASS
- [x] **Step 5: Commit** → `git commit -am "feat: 入庫前三道驗證"`

---

### Task 5: diff — 異動偵測（spec §5 雙門檻） ✅ 完成（commit 22e3805）

**Files:** Create: `scraper/src/activeetf/diff.py`, Test: `scraper/tests/test_diff.py`

- [x] **Step 1: 失敗測試**

```python
# tests/test_diff.py
from activeetf.models import Holding
from activeetf.diff import diff_snapshots

def _snap(*rows):
    return {r[0]: Holding(stock_id=r[0], shares=r[1], weight_pct=r[2]) for r in rows}

def test_new_and_exit():
    prev = _snap(("2330", 1000, 50.0))
    curr = _snap(("2317", 500, 48.0))
    types = {c.stock_id: c.change_type for c in diff_snapshots(prev, curr)}
    assert types == {"2317": "NEW", "2330": "EXIT"}

def test_add_and_trim_require_both_thresholds():
    prev = _snap(("2330", 1000, 50.0), ("2317", 1000, 30.0), ("2454", 1000, 15.0))
    curr = _snap(("2330", 1500, 50.30), ("2317", 900, 29.90), ("2454", 1001, 15.001))
    changes = {c.stock_id: c for c in diff_snapshots(prev, curr)}
    assert changes["2330"].change_type == "ADD"     # 股數+ 且 |Δw|=0.30 ≥ 0.05
    assert changes["2317"].change_type == "TRIM"    # 股數- 且 |Δw|=0.10 ≥ 0.05
    assert "2454" not in changes                     # Δw 0.001 < 0.05 → 申贖/雜訊過濾

def test_price_only_weight_move_is_not_a_change():
    prev = _snap(("2330", 1000, 50.0))
    curr = _snap(("2330", 1000, 53.0))   # 股數沒動，純價格波動
    assert diff_snapshots(prev, curr) == []

def test_deltas_are_signed():
    prev = _snap(("2330", 1000, 50.0))
    curr = _snap(("2330", 1500, 50.4))
    c = diff_snapshots(prev, curr)[0]
    assert c.shares_delta == 500 and abs(c.weight_delta_pct - 0.4) < 1e-9
```

- [x] **Step 2: 確認失敗** → `uv run pytest tests/test_diff.py -v` → FAIL
- [x] **Step 3: 實作**

```python
# src/activeetf/diff.py
"""相鄰兩日快照 diff → 異動事件。
ADD/TRIM 需「股數變化」與「|權重變化| >= 0.05pp」同時成立（spec §5）：
申贖造成的等比例股數變動權重幾乎不動，會被權重門檻自然過濾。
NEW/EXIT 無門檻——進出本身就是訊號。"""
from activeetf.models import Holding, Change

WEIGHT_DELTA_MIN_PP = 0.05

def diff_snapshots(prev: dict[str, Holding], curr: dict[str, Holding]) -> list[Change]:
    changes: list[Change] = []
    for sid, h in curr.items():
        p = prev.get(sid)
        if p is None:
            changes.append(Change(sid, "NEW", h.shares, h.weight_pct))
            continue
        ds = h.shares - p.shares
        dw = h.weight_pct - p.weight_pct
        if ds != 0 and abs(dw) >= WEIGHT_DELTA_MIN_PP:
            changes.append(Change(sid, "ADD" if ds > 0 else "TRIM", ds, dw))
    for sid, p in prev.items():
        if sid not in curr:
            changes.append(Change(sid, "EXIT", -p.shares, -p.weight_pct))
    return sorted(changes, key=lambda c: c.stock_id)
```

- [x] **Step 4: 確認通過** → PASS
- [x] **Step 5: Commit** → `git commit -am "feat: 快照 diff 異動偵測（雙門檻）"`

---

### Task 6: finmind client ⚠️ client 完成，live 驗證發現價格資料集受帳號等級阻擋

**Files:** Create: `scraper/src/activeetf/finmind.py`, Test: `scraper/tests/test_finmind.py`

- [x] **Step 1: 失敗測試（responses 模擬 HTTP）**

```python
# tests/test_finmind.py
import responses
from activeetf import finmind

BASE = "https://api.finmindtrade.com/api/v4/data"

def _mock(dataset_data):
    responses.add(responses.GET, BASE, json={"status": 200, "msg": "success", "data": dataset_data})

@responses.activate
def test_market_close_returns_rows(monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "t")
    _mock([{"stock_id": "2330", "date": "2026-07-03", "close": 1000.0}])
    rows = finmind.market_close("2026-07-03")
    assert rows[0]["stock_id"] == "2330"

@responses.activate
def test_error_status_raises(monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "t")
    responses.add(responses.GET, BASE, json={"status": 400, "msg": "bad token"})
    try:
        finmind.market_close("2026-07-03")
        assert False
    except RuntimeError as e:
        assert "bad token" in str(e)

@responses.activate
def test_is_trading_day_false_when_empty(monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "t")
    _mock([])
    assert finmind.is_trading_day("2026-07-04") is False
```

- [x] **Step 2: 確認失敗** → FAIL
- [x] **Step 3: 實作**

```python
# src/activeetf/finmind.py
"""FinMind 行情 client。每日用量：market_close 1 次 + adj_prices 若干 + index 1 次，
遠低於免費層 600 次/時。TWSE OpenAPI 備援屬後續擴充（spec §9）。"""
import os
import requests

BASE = "https://api.finmindtrade.com/api/v4/data"
TAIEX_TRI = "TAIEX_TRI"   # 我們在 stock_price 表中使用的加權報酬指數代號

def _get(params: dict) -> list[dict]:
    headers = {"Authorization": f"Bearer {os.environ['FINMIND_TOKEN']}"}
    r = requests.get(BASE, params=params, headers=headers, timeout=60)
    r.raise_for_status()
    body = r.json()
    if body.get("status") != 200:
        raise RuntimeError(f"FinMind error: {body.get('msg')}")
    return body["data"]

def market_close(date: str) -> list[dict]:
    """當日全市場收盤價（單次呼叫）。"""
    return _get({"dataset": "TaiwanStockPrice", "start_date": date, "end_date": date})

def adj_prices(stock_id: str, start: str, end: str) -> list[dict]:
    """單一標的還原價序列（報酬/勝率計算用）。"""
    return _get({"dataset": "TaiwanStockPriceAdj", "data_id": stock_id,
                 "start_date": start, "end_date": end})

def total_return_index(start: str, end: str) -> list[dict]:
    """發行量加權股價報酬指數（含息）。data_id=TAIEX。"""
    return _get({"dataset": "TaiwanStockTotalReturnIndex", "data_id": "TAIEX",
                 "start_date": start, "end_date": end})

def stock_info() -> list[dict]:
    return _get({"dataset": "TaiwanStockInfo"})

def is_trading_day(date: str) -> bool:
    """以 0050 當日是否有價判定交易日。"""
    return len(_get({"dataset": "TaiwanStockPrice", "data_id": "0050",
                     "start_date": date, "end_date": date})) > 0
```

- [x] **Step 4: 確認通過** → PASS
- [x] **Step 5: 實測一次真 API（人工確認）** — 2026-07-07 已實測：`TaiwanStockTotalReturnIndex` 可取且欄位為 `price`；`TaiwanStockPrice` / `TaiwanStockPriceAdj` 回 400（register/free 等級不足），已同步 spec §2

Run: `uv run python -c "from activeetf import finmind; print(len(finmind.market_close('2026-07-03')))"`
Expected: 一個 > 1000 的數字（全市場檔數）。**注意**：若 `TaiwanStockPriceAdj`／`TaiwanStockTotalReturnIndex` 在免費層拿不到或欄位不同，在此步驟就會發現——立即記錄實際欄位並調整 client，不要拖到 pipeline 才炸。

- [x] **Step 6: Commit** → `git commit -am "feat: FinMind 行情 client"`

---

### Task 7: db — 持久層

**Files:** Create: `scraper/src/activeetf/db.py`, Test: `scraper/tests/test_db.py`

原則：唯一碰 SQL 的模組；業務邏輯（validate/diff/metrics）全部與 DB 解耦。整合測試需要 `SUPABASE_DB_URL`，沒有就 skip。

- [ ] **Step 1: 失敗測試**

```python
# tests/test_db.py
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
```

- [ ] **Step 2: 確認失敗** → FAIL
- [ ] **Step 3: 實作**

```python
# src/activeetf/db.py
import os, datetime as dt
from contextlib import contextmanager
import psycopg
from activeetf.models import Holding, Change

@contextmanager
def conn():
    with psycopg.connect(os.environ["SUPABASE_DB_URL"], autocommit=True) as c:
        yield c

def write_snapshot(etf_id: str, d: dt.date, holdings: list[Holding]) -> None:
    with conn() as c, c.cursor() as cur:
        cur.executemany(
            """insert into holdings_snapshot (etf_id, trade_date, stock_id, shares, weight_pct)
               values (%s,%s,%s,%s,%s) on conflict do nothing""",
            [(etf_id, d, h.stock_id, h.shares, h.weight_pct) for h in holdings])

def load_snapshot(etf_id: str, d: dt.date) -> dict[str, Holding]:
    with conn() as c:
        rows = c.execute("""select stock_id, shares, weight_pct from holdings_snapshot
                            where etf_id=%s and trade_date=%s""", (etf_id, d)).fetchall()
    return {r[0]: Holding(r[0], int(r[1]), float(r[2])) for r in rows}

def latest_snapshot_date(etf_id: str, before: dt.date) -> dt.date | None:
    with conn() as c:
        row = c.execute("""select max(trade_date) from holdings_snapshot
                           where etf_id=%s and trade_date < %s""", (etf_id, before)).fetchone()
    return row[0]

def snapshot_count(etf_id: str, d: dt.date) -> int | None:
    with conn() as c:
        row = c.execute("""select count(*) from holdings_snapshot
                           where etf_id=%s and trade_date=%s""", (etf_id, d)).fetchone()
    return row[0] or None

def write_changes(etf_id: str, d: dt.date, changes: list[Change]) -> None:
    with conn() as c, c.cursor() as cur:
        cur.executemany(
            """insert into holding_change (etf_id, trade_date, stock_id, change_type,
               shares_delta, weight_delta_pct) values (%s,%s,%s,%s,%s,%s)
               on conflict (etf_id, trade_date, stock_id) do update
               set change_type=excluded.change_type, shares_delta=excluded.shares_delta,
                   weight_delta_pct=excluded.weight_delta_pct""",
            [(etf_id, d, ch.stock_id, ch.change_type, ch.shares_delta, ch.weight_delta_pct)
             for ch in changes])

def upsert_prices(rows: list[tuple]) -> None:
    """rows: (stock_id, trade_date, close, adj_close)"""
    with conn() as c, c.cursor() as cur:
        cur.executemany(
            """insert into stock_price (stock_id, trade_date, close, adj_close)
               values (%s,%s,%s,%s) on conflict (stock_id, trade_date) do update
               set close=coalesce(excluded.close, stock_price.close),
                   adj_close=coalesce(excluded.adj_close, stock_price.adj_close)""", rows)

def upsert_stock_info(rows: list[tuple]) -> None:
    """rows: (stock_id, name, industry, market)"""
    with conn() as c, c.cursor() as cur:
        cur.executemany(
            """insert into stock_info (stock_id, name, industry, market)
               values (%s,%s,%s,%s) on conflict (stock_id) do update
               set name=excluded.name, industry=excluded.industry, market=excluded.market""", rows)

def known_stock_ids() -> set[str]:
    with conn() as c:
        return {r[0] for r in c.execute("select stock_id from stock_info").fetchall()}

def log_scrape(etf_id: str, d: dt.date, status: str, error: str | None = None) -> None:
    with conn() as c:
        c.execute("insert into scrape_log (etf_id, trade_date, status, error) values (%s,%s,%s,%s)",
                  (etf_id, d, status, error))

def scraped_ok(etf_id: str, d: dt.date) -> bool:
    with conn() as c:
        row = c.execute("""select 1 from scrape_log where etf_id=%s and trade_date=%s
                           and status='ok' limit 1""", (etf_id, d)).fetchone()
    return row is not None
```

- [ ] **Step 4: 確認通過** → `uv run pytest tests/test_db.py -v` → PASS（有 env 時）
- [ ] **Step 5: Commit** → `git commit -am "feat: db 持久層（快照/事件/價格/log）"`

---

### Task 8: registry + 官網探測 ✅ 完成（commit b1301ae）

**Files:** Create: `scraper/src/activeetf/registry.py`, `scraper/scripts/probe.py`

- [x] **Step 1: 建 registry（先填結構與已知資訊，PCF URL 逐檔補）**

```python
# src/activeetf/registry.py
"""ETF ↔ 投信 ↔ adapter ↔ PCF URL 對照。
新 ETF 上市：同投信加一行；新投信：寫新 adapter（見 CLAUDE.md 預定 skill new-adapter）。
adapter=None 表示尚未實作——pipeline 會跳過並記 fail，Dashboard 黃條可見。"""
from dataclasses import dataclass

@dataclass(frozen=True)
class EtfEntry:
    etf_id: str
    name: str
    issuer: str
    universe: str        # 'tw' | 'global'
    pcf_url: str | None
    adapter: str | None  # adapters/ 下的模組名

REGISTRY: list[EtfEntry] = [
    # 首波實作（Task 10）
    EtfEntry("00992A", "主動群益科技創新", "群益", "tw",
             "https://www.capitalfund.com.tw/etf/product/detail/500/portfolio", "capital"),
    EtfEntry("00982A", "主動群益台灣強棒", "群益", "tw", None, "capital"),
    EtfEntry("00997A", "主動群益美國增長", "群益", "global", None, "capital"),
    # 其餘投信：Task 12 探測後逐檔補 pcf_url 與 adapter
    EtfEntry("00981A", "主動統一台股增長", "統一", "tw", None, None),
    EtfEntry("00980A", "主動野村臺灣優選", "野村", "tw", None, None),
    # ...（Step 2 由 FinMind 清單補齊全部 A 結尾條目）
]

def entries() -> list[EtfEntry]:
    return REGISTRY

def by_id(etf_id: str) -> EtfEntry:
    return next(e for e in REGISTRY if e.etf_id == etf_id)
```

- [x] **Step 2: 用 FinMind 補齊全部 A 結尾清單**（實作時改用已查得的 28 檔清單直接填入，未即時呼叫 API）

```bash
uv run python - <<'EOF'
from activeetf import finmind
rows = [r for r in finmind.stock_info()
        if r["industry_category"] == "ETF" and r["stock_id"].endswith("A")
        and r["stock_name"].startswith("主動")]
for r in sorted({x["stock_id"]: x for x in rows}.values(), key=lambda x: x["stock_id"]):
    print(f'    EtfEntry("{r["stock_id"]}", "{r["stock_name"]}", "", "tw", None, None),')
EOF
```

把輸出貼進 REGISTRY，人工補 issuer；美股/全球型（名稱含「美國/全球/ARK」）改 `universe="global"`。

- [x] **Step 3: 寫探測腳本**

```python
# scripts/probe.py
"""打一遍全部投信 PCF 頁，回報 HTTP 狀態與內容長度——判斷海外 IP 封鎖（spec §5 風險）。
用法：uv run python scripts/probe.py   （在本機與 GitHub Actions 各跑一次比對）"""
import time, requests
from activeetf.registry import entries

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

for e in entries():
    if not e.pcf_url:
        print(f"{e.etf_id}  SKIP (no url yet)")
        continue
    try:
        r = requests.get(e.pcf_url, headers=UA, timeout=30)
        print(f"{e.etf_id}  {r.status_code}  {len(r.content):>8} bytes  {e.pcf_url}")
    except Exception as ex:
        print(f"{e.etf_id}  ERROR {type(ex).__name__}: {ex}")
    time.sleep(1.5)   # 禮貌間隔
```

- [x] **Step 4: 本機跑一次** → `uv run python scripts/probe.py` → 00992A 回 200（413KB，實為 Angular SSR 殼，後續發現真資料在 JSON API，見 Task 10）；其餘 27 檔待 Task 12 逐家補 URL 後探測
- [x] **Step 5: Commit** → `git commit -am "feat: ETF registry 與官網探測腳本"`

---

### Task 9: adapter 基礎 ✅ 完成（commit 67b7862）

**Files:** Create: `scraper/src/activeetf/adapters/base.py`

- [x] **Step 1: 定義統一介面**

```python
# src/activeetf/adapters/base.py
"""Adapter 統一介面：fetch(entry) -> list[Holding]。
每家投信一個模組，模組內只管「怎麼把該家格式轉成 Holding」；
重試、驗證、入庫都在 pipeline，adapter 保持純粹。"""
import importlib
from typing import Protocol
from activeetf.models import Holding
from activeetf.registry import EtfEntry

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

class Adapter(Protocol):
    def fetch(self, entry: EtfEntry) -> list[Holding]: ...

def load(name: str) -> Adapter:
    return importlib.import_module(f"activeetf.adapters.{name}")
```

- [x] **Step 2: Commit** → `git commit -am "feat: adapter 統一介面"`

---

### Task 10: 首個 adapter — 群益（範本） ✅ 完成（commit 43a71c0，清理 commit 5665626）

**Files:** Create: `scraper/src/activeetf/adapters/capital.py`, `scraper/tests/fixtures/capital_00992A.html`, Test: `scraper/tests/test_adapter_capital.py`

**流程說明（之後每家 adapter 都走同樣四步，這是 new-adapter skill 的雛形）：錄 fixture → 對 fixture 寫測試 → 實作解析 → 真連線驗證。**

**實際結果與計畫不同**：群益官網是 Angular SSR 殼，靜態 HTML 只渲染前 10 大持股（權重 56%，不到驗證門檻）。真正資料源是 `POST /CFWeb/api/etf/buyback`（fundId 參數）；fixture 因此改為 JSON（`capital_00992A.json`），原先錄的 HTML 已於清理 commit 移除。

- [x] **Step 1: 錄下真實頁面當 fixture**（實際錄的是 JSON API response，非 HTML）

```bash
curl -sL -A "Mozilla/5.0" \
  "https://www.capitalfund.com.tw/etf/product/detail/500/portfolio" \
  -o tests/fixtures/capital_00992A.html
grep -c 2330 tests/fixtures/capital_00992A.html   # 應 >0，確認持股表在靜態 HTML 內
```

**若 grep 為 0** → 資料是 JS 動態載入：改用瀏覽器 DevTools Network 找出後端 JSON API，把該 API response 存成 `capital_00992A.json`，adapter 改打 API（更穩定）。fixture 的形式跟著實況走。

- [x] **Step 2: 對 fixture 寫不變量測試（不 hardcode 具體持股，資料每天會變）**

```python
# tests/test_adapter_capital.py
from pathlib import Path
from activeetf.adapters import capital

FIXTURE = Path(__file__).parent / "fixtures" / "capital_00992A.html"

def test_parses_fixture_into_plausible_holdings():
    holdings = capital.parse(FIXTURE.read_text())
    assert len(holdings) >= 10                       # 主動式股票 ETF 至少數十檔
    total = sum(h.weight_pct for h in holdings)
    assert 70 <= total <= 101                        # 與入庫驗證同標準
    for h in holdings:
        assert h.stock_id and h.shares > 0 and 0 < h.weight_pct < 60
    assert len({h.stock_id for h in holdings}) == len(holdings)   # 無重複
```

- [x] **Step 3: 確認失敗** → `uv run pytest tests/test_adapter_capital.py -v` → FAIL
- [x] **Step 4: 實作解析**（改為解析 JSON `data.stocks[]`，非計畫原先假設的 HTML 表格——見上方說明）

```python
# src/activeetf/adapters/capital.py
"""群益投信 PCF。頁面為 HTML 表格：股票代號 / 名稱 / 權重(%) / 股數。
selector 以 fixture 實測為準；表格結構改版時本測試會先炸，照 Task 10 流程重錄 fixture。"""
import requests
from bs4 import BeautifulSoup
from activeetf.models import Holding
from activeetf.adapters.base import UA
from activeetf.registry import EtfEntry

def parse(html: str) -> list[Holding]:
    soup = BeautifulSoup(html, "lxml")
    holdings = []
    for row in soup.select("table tbody tr"):
        cells = [c.get_text(strip=True) for c in row.select("td")]
        if len(cells) < 4 or not cells[0][:4].isalnum():
            continue
        stock_id, _name, weight, shares = cells[0], cells[1], cells[2], cells[3]
        holdings.append(Holding(
            stock_id=stock_id.strip(),
            shares=int(shares.replace(",", "").split(".")[0]),
            weight_pct=float(weight.replace("%", "").replace(",", "")),
        ))
    return holdings

def fetch(entry: EtfEntry) -> list[Holding]:
    r = requests.get(entry.pcf_url, headers=UA, timeout=30)
    r.raise_for_status()
    return parse(r.text)
```

- [x] **Step 5: 確認通過** → PASS（依 fixture 實況修 selector 直到過）
- [x] **Step 6: 真連線煙霧測試（人工）**

```bash
uv run python -c "
from activeetf.registry import by_id
from activeetf.adapters import capital
hs = capital.fetch(by_id('00992A'))
print(len(hs), sum(h.weight_pct for h in hs))
print(sorted(hs, key=lambda h: -h.weight_pct)[:5])"
```

Expected: 筆數與權重和合理；前五大持股與官網頁面目視一致。
實測結果：00992A 35 檔／97.66%（top 2330 台積電 7.72%）。

- [x] **Step 7: 補 00982A / 00997A 的 pcf_url 到 registry（同站不同基金 id，觀察 URL 規律），各跑一次 Step 6 驗證**
  實測：00982A（fundId 399）55 檔／98.79%；00997A（fundId 502，美股）52 檔／89.59%（top MU 5.70%，US 股號含空格後綴如「MU US」）。
- [x] **Step 8: Commit** → `git commit -am "feat: 群益 adapter（含 fixture 測試）"`（含後續清理 commit 5665626 移除未用的 HTML fixture）

---

### Task 11: pipeline — 每日主流程 ✅ 完成（commit 7a4cdc5，含 db.py stub 因 Task 7 尚未落地）

**Files:** Create: `scraper/src/activeetf/pipeline.py`, Test: `scraper/tests/test_pipeline.py`

- [x] **Step 1: 失敗測試（全用 fake，不碰網路與 DB）**

```python
# tests/test_pipeline.py
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
```

- [x] **Step 2: 確認失敗** → FAIL
- [x] **Step 3: 實作**

```python
# src/activeetf/pipeline.py
"""每日主流程。18:30 主場與 21:30 補抓場跑同一支：scraped_ok 者跳過即天然冪等。"""
import datetime as dt
import time, traceback
from activeetf import db, finmind
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
    except (ValidationError, Exception) as ex:   # 單檔失敗不擴散（spec §5 隔離）
        deps.log_scrape(entry.etf_id, today, "fail", f"{type(ex).__name__}: {ex}\n{traceback.format_exc()[-800:]}")

def refresh_stock_info() -> None:
    rows = [(r["stock_id"], r["stock_name"], r.get("industry_category"), r.get("type"))
            for r in finmind.stock_info()]
    db.upsert_stock_info(rows)

def ingest_prices(today: dt.date) -> None:
    """當日全市場收盤 1 次呼叫入庫；還原價與指數由 metrics 階段按需拉（Task 13）。"""
    rows = [(r["stock_id"], r["date"], r.get("close"), None) for r in finmind.market_close(str(today))]
    db.upsert_prices(rows)

def main() -> int:
    today = dt.date.today()
    if not finmind.is_trading_day(str(today)):
        print(f"{today} 非交易日，跳過")
        return 0
    refresh_stock_info()
    deps = Deps()
    for entry in entries():
        scrape_one(entry, today, deps)
        time.sleep(1.5)
    ingest_prices(today)
    from activeetf import metrics
    metrics.compute_all(today)          # Task 13/14
    failed = [e.etf_id for e in entries() if not db.scraped_ok(e.etf_id, today)]
    print(f"完成。失敗/未實作: {failed}")
    return 1 if len(failed) == len(list(entries())) else 0   # 全滅才讓 job 紅

if __name__ == "__main__":
    raise SystemExit(main())
```

（`metrics.compute_all` 到 Task 13 才存在——本 task 先在該行處以 `pass` 佔位並於測試中不觸及 `main()`；Task 13 完成時移除佔位。）

- [x] **Step 4: 確認通過** → `uv run pytest tests/test_pipeline.py -v` → PASS
- [x] **Step 5: Commit** → `git commit -am "feat: 每日 pipeline（隔離、冪等、驗證整合）"`

---

### Task 12: 其餘投信 adapter（逐家循環） ⏳ 進行中 — 群益（3 檔）+ 野村（3 檔）+ 台新（2 檔）+ 富邦（1 檔）完成，尚餘 19 檔 ETF

**Files:** Create: `scraper/src/activeetf/adapters/<issuer>.py` × 每家、對應 fixture 與測試

這是本計畫工作量最大的部分，但**每家都走 Task 10 的固定四步**（錄 fixture → 不變量測試 → 實作 → 真連線驗證），不變量測試的內容完全相同（複製 `test_adapter_capital.py` 改名）。無法在本文件預寫各家解析程式碼——各家 HTML/API 結構必須實地錄下 fixture 才知道，預寫等於捏造。

- [ ] **Step 1: 依 Task 8 探測結果排定順序**：靜態 HTML/JSON API 的先做（快），需要 JS 渲染的最後做（可能要 playwright，屆時再加依賴——YAGNI）
- [ ] **Step 2: 每完成一家：更新 registry 的 pcf_url + adapter 欄、跑該家煙霧測試、單獨 commit**（`feat: <投信> adapter`）
  - [x] 野村：00980A / 00985A / 00999A，官方 API `Fund/GetFundTradeInfoDate` + `Fund/GetFundTradeInfo`；live smoke：48/50/61 檔，權重 90.86%/92.26%/96.19%
  - [x] 台新：00986A / 00987A，官方 ETF detail HTML 靜態表格；live smoke：32/28 檔，權重 92.02%/96.11%；00986A 確認為 global universe，00987A 台股代號需移除 ` TT` suffix
  - [x] 富邦：00405A，官方 `Assets.aspx` 靜態表格；live smoke：50 檔，權重 95.87%
- [ ] **Step 3: 全部完成後跑全量煙霧測試**

```bash
uv run python -c "
from activeetf.registry import entries
from activeetf.adapters import base
import time
for e in entries():
    hs = base.load(e.adapter).fetch(e)
    print(e.etf_id, len(hs), round(sum(h.weight_pct for h in hs), 2))
    time.sleep(1.5)"
```

Expected: 每檔筆數 >10、權重和 70–101。
- [ ] **Step 4: 完成第 3 家後，依 CLAUDE.md 的約定建立 `new-adapter` 專案 skill**（此時流程已被實走多遍，符合 writing-skills 的測試前提）
- [ ] **Step 5: Commit**（每家一個，已含在 Step 2）

---

### Task 13: metrics — 報酬與擇時勝率（spec §6） ⚠️ 程式與測試完成，FinMind 還原價 endpoint 受帳號等級阻擋

**Files:** Create: `scraper/src/activeetf/metrics.py`, Test: `scraper/tests/test_metrics.py`

- [x] **Step 1: 失敗測試（純函式，餵合成價格序列）**

```python
# tests/test_metrics.py
import datetime as dt
from activeetf import metrics

def _series(start: str, closes: list[float]) -> dict[dt.date, float]:
    d0 = dt.date.fromisoformat(start)
    out, d = {}, d0
    i = 0
    while i < len(closes):
        if d.weekday() < 5:            # 平日視為交易日
            out[d] = closes[i]; i += 1
        d += dt.timedelta(days=1)
    return out

def test_trailing_return_1m():
    # 30 個交易日 100 → 110：近一月報酬應為正且 ≈ 10%
    s = _series("2026-05-20", [100 + i * 10 / 29 for i in range(30)])
    last = max(s)
    r = metrics.trailing_return(s, last, months=1)
    assert r is not None and 0.08 < r < 0.12

def test_trailing_return_none_when_history_too_short():
    s = _series("2026-07-01", [100, 101, 102])
    assert metrics.trailing_return(s, max(s), months=12) is None

def test_timing_win_rate():
    # ETF 每月 +2%、基準每月 +1% → 全勝
    etf = _series("2026-01-05", [100 * (1.001 ** i) for i in range(120)])
    bench = _series("2026-01-05", [100 * (1.0005 ** i) for i in range(120)])
    wins, months = metrics.timing_win_rate(etf, bench)
    assert months >= 4 and wins == months
```

- [x] **Step 2: 確認失敗** → FAIL（`activeetf.metrics` 尚不存在）
- [x] **Step 3: 實作**

```python
# src/activeetf/metrics.py
"""指標計算（spec §6）。所有函式吃 {date: adj_close} 純 dict，不碰 DB/網路；
compute_all 負責組裝資料與寫回 etf_metrics。"""
import datetime as dt
from activeetf import db, finmind

Series = dict[dt.date, float]

def _at_or_before(s: Series, d: dt.date) -> tuple[dt.date, float] | None:
    ds = [x for x in s if x <= d]
    if not ds:
        return None
    k = max(ds)
    return k, s[k]

def trailing_return(s: Series, asof: dt.date, months: int) -> float | None:
    """近 N 月報酬；歷史不足回傳 None（spec：不滿顯示 —，不硬算）。"""
    end = _at_or_before(s, asof)
    target = asof - dt.timedelta(days=months * 30 + 5)
    if end is None or min(s) > target:
        return None
    start = _at_or_before(s, asof - dt.timedelta(days=months * 30))
    if start is None or start[1] == 0:
        return None
    return end[1] / start[1] - 1.0

def inception_return(s: Series, asof: dt.date) -> float | None:
    end = _at_or_before(s, asof)
    if end is None or not s:
        return None
    first = s[min(s)]
    return end[1] / first - 1.0 if first else None

def _month_ends(s: Series) -> list[dt.date]:
    by_month: dict[tuple[int, int], dt.date] = {}
    for d in s:
        key = (d.year, d.month)
        by_month[key] = max(d, by_month.get(key, d))
    return sorted(by_month.values())[:-1]   # 最後一個月可能不完整，丟掉

def timing_win_rate(etf: Series, bench: Series) -> tuple[int, int]:
    """完整月份月報酬 vs 基準。回傳 (贏的月數, 總月數)。"""
    ends = [d for d in _month_ends(etf) if d in _month_ends(bench) or _at_or_before(bench, d)]
    wins = months = 0
    for prev, cur in zip(ends, ends[1:]):
        e0, e1 = _at_or_before(etf, prev), _at_or_before(etf, cur)
        b0, b1 = _at_or_before(bench, prev), _at_or_before(bench, cur)
        if None in (e0, e1, b0, b1):
            continue
        months += 1
        if e1[1] / e0[1] > b1[1] / b0[1]:
            wins += 1
    return wins, months

def load_adj_series(stock_id: str, start: dt.date, end: dt.date) -> Series:
    """優先讀 stock_price.adj_close，缺的區間打 FinMind 補並回寫（快取）。"""
    with db.conn() as c:
        rows = c.execute("""select trade_date, adj_close from stock_price
                            where stock_id=%s and trade_date between %s and %s
                            and adj_close is not null""", (stock_id, start, end)).fetchall()
    s = {r[0]: float(r[1]) for r in rows}
    if not s or max(s) < end - dt.timedelta(days=3):
        fetched = finmind.adj_prices(stock_id, str(start), str(end))
        db.upsert_prices([(r["stock_id"], r["date"], None, r.get("close")) for r in fetched])
        for r in fetched:
            s[dt.date.fromisoformat(r["date"])] = float(r["close"])
    return s

def compute_all(today: dt.date) -> None:
    """報酬 + 擇時勝率 + 選股勝率 + 風格指標，寫入 etf_metrics。"""
    from activeetf.registry import entries
    start = dt.date(2025, 5, 1)   # 首檔主動式 ETF 上市月
    bench_0050 = load_adj_series("0050", start, today)
    tri = load_tri_series(start, today)
    for e in entries():
        etf_s = load_adj_series(e.etf_id, start, today)
        if not etf_s:
            continue
        wins, months = timing_win_rate(etf_s, bench_0050)
        pick = picking_win_rate(e.etf_id, today, tri)          # Task 14
        style = style_metrics(e.etf_id, today)                  # Task 14
        row = {
            "ret_1m": trailing_return(etf_s, today, 1),
            "ret_3m": trailing_return(etf_s, today, 3),
            "ret_6m": trailing_return(etf_s, today, 6),
            "ret_1y": trailing_return(etf_s, today, 12),
            "ret_inception": inception_return(etf_s, today),
            "bench_0050_1m": trailing_return(bench_0050, today, 1),
            "bench_0050_3m": trailing_return(bench_0050, today, 3),
            "bench_0050_6m": trailing_return(bench_0050, today, 6),
            "bench_0050_1y": trailing_return(bench_0050, today, 12),
            "timing_wins": wins, "timing_months": months,
            **pick, **style,
        }
        _write_metrics(e.etf_id, today, row)

def load_tri_series(start: dt.date, end: dt.date) -> Series:
    with db.conn() as c:
        rows = c.execute("""select trade_date, adj_close from stock_price
                            where stock_id=%s and trade_date between %s and %s""",
                         (finmind.TAIEX_TRI, start, end)).fetchall()
    s = {r[0]: float(r[1]) for r in rows}
    if not s or max(s) < end - dt.timedelta(days=3):
        fetched = finmind.total_return_index(str(start), str(end))
        db.upsert_prices([(finmind.TAIEX_TRI, r["date"], None, r["price"]) for r in fetched])
        for r in fetched:
            s[dt.date.fromisoformat(r["date"])] = float(r["price"])
    return s

def _write_metrics(etf_id: str, d: dt.date, row: dict) -> None:
    cols = ", ".join(row)
    ph = ", ".join(["%s"] * len(row))
    sets = ", ".join(f"{k}=excluded.{k}" for k in row)
    with db.conn() as c:
        c.execute(f"""insert into etf_metrics (etf_id, trade_date, {cols})
                      values (%s, %s, {ph})
                      on conflict (etf_id, trade_date) do update set {sets}""",
                  (etf_id, d, *row.values()))
```

（`picking_win_rate` / `style_metrics` 於 Task 14 實作；本 task 測試不觸及 `compute_all`，先讓兩者回傳空 dict 的 stub 放在 metrics.py 底部，Task 14 以 TDD 取代。）

- [x] **Step 4: 確認通過** → `uv run pytest tests/test_metrics.py -v` → PASS；`uv run pytest -v` → 25 passed
- [x] **Step 5: FinMind 欄位實測**：`TaiwanStockTotalReturnIndex` 真呼叫成功，欄位為 `price`；`TaiwanStockPriceAdj` 真呼叫回 400（目前 token 等級為 register，需 backer/sponsor），官方文件欄位為 `close`。不改用未還原價，已同步 spec §2。
- [x] **Step 6: Commit** → `git commit -m "feat: 報酬與擇時勝率計算"`

---

### Task 14: metrics — 選股勝率與風格指標（spec §6 最終版規則） ✅ 完成

**Files:** Modify: `scraper/src/activeetf/metrics.py`, Test: `scraper/tests/test_metrics_picking.py`

- [x] **Step 1: 失敗測試**

```python
# tests/test_metrics_picking.py
import datetime as dt
from activeetf.metrics import build_rounds, score_rounds

D = dt.date.fromisoformat

# events: (trade_date, stock_id, change_type, shares_delta, prev_shares)
def test_build_rounds_pairs_entry_with_exit():
    events = [
        (D("2026-06-01"), "2330", "NEW", 1000, 0),
        (D("2026-06-10"), "2330", "EXIT", -1000, 1000),
        (D("2026-06-05"), "2317", "NEW", 500, 0),
    ]
    rounds = build_rounds(events)
    assert (D("2026-06-01"), "2330", D("2026-06-10")) in [(r.entry, r.stock_id, r.exit) for r in rounds]
    assert any(r.stock_id == "2317" and r.exit is None for r in rounds)   # 未平倉

def test_add_below_10pct_shares_is_not_an_event():
    events = [
        (D("2026-06-01"), "2330", "NEW", 1000, 0),
        (D("2026-06-03"), "2330", "ADD", 50, 1000),    # +5% 股數：申贖噪音，不成回合
        (D("2026-06-04"), "2330", "ADD", 200, 1050),   # +19%：成回合
    ]
    rounds = build_rounds(events)
    assert len([r for r in rounds if r.stock_id == "2330"]) == 2   # NEW 一回合 + 大 ADD 一回合

def test_score_rounds_realized_vs_open():
    # 股票漲 10%、大盤漲 1% → 勝；未平倉但滿 5 交易日 → 計浮動分
    stock = {D("2026-06-01") + dt.timedelta(days=i): 100 + i for i in range(15)}
    tri   = {D("2026-06-01") + dt.timedelta(days=i): 100 + i * 0.1 for i in range(15)}
    rounds = build_rounds([(D("2026-06-01"), "2330", "NEW", 1000, 0)])
    res = score_rounds(rounds, {"2330": stock}, tri, asof=D("2026-06-15"), min_open_days=5)
    assert res["picking_open_wins"] == 1 and res["picking_open_total"] == 1
    assert res["picking_realized_total"] == 0

def test_open_round_below_min_days_not_scored():
    stock = {D("2026-06-01"): 100.0, D("2026-06-02"): 130.0}
    tri = dict(stock)
    rounds = build_rounds([(D("2026-06-01"), "2330", "NEW", 1000, 0)])
    res = score_rounds(rounds, {"2330": stock}, tri, asof=D("2026-06-02"), min_open_days=5)
    assert res["picking_open_total"] == 0   # 未滿 5 個交易日不計
```

- [x] **Step 2: 確認失敗** → FAIL（`build_rounds` / `score_rounds` 尚不存在）
- [x] **Step 3: 實作（取代 Task 13 的 stub）**

```python
# 追加於 src/activeetf/metrics.py（取代底部 stub）
from dataclasses import dataclass

MIN_OPEN_SCORING_DAYS = 5      # spec §6：待回測的起始值
ADD_EVENT_MIN_SHARE_GROWTH = 0.10

@dataclass(frozen=True)
class Round:
    stock_id: str
    entry: dt.date
    exit: dt.date | None       # None = 未平倉

def build_rounds(events: list[tuple]) -> list[Round]:
    """事件 → 回合。進場 = NEW 或 ADD(股數增幅≥10%)；出場 = 之後最近的 EXIT。
    TRIM 不結束回合（spec §6）。"""
    entries_, exits = [], {}
    for d, sid, typ, delta, prev_shares in sorted(events):
        if typ == "NEW":
            entries_.append((d, sid))
        elif typ == "ADD" and prev_shares and delta / prev_shares >= ADD_EVENT_MIN_SHARE_GROWTH:
            entries_.append((d, sid))
        elif typ == "EXIT":
            exits.setdefault(sid, []).append(d)
    rounds = []
    for d, sid in entries_:
        exit_d = min((x for x in exits.get(sid, []) if x > d), default=None)
        rounds.append(Round(sid, d, exit_d))
    return rounds

def _window_return(s: Series, start: dt.date, end: dt.date) -> float | None:
    a, b = _at_or_before(s, start), _at_or_before(s, end)
    if a is None or b is None or a[0] == b[0] or a[1] == 0:
        return None
    return b[1] / a[1] - 1.0

def score_rounds(rounds: list[Round], stock_series: dict[str, Series],
                 tri: Series, asof: dt.date, min_open_days: int = MIN_OPEN_SCORING_DAYS) -> dict:
    realized_w = realized_t = open_w = open_t = 0
    trading_days = sorted(tri)
    for r in rounds:
        s = stock_series.get(r.stock_id)
        if not s:
            continue                      # 海外持倉等無台股價者不計（spec §1 範圍限定）
        end = r.exit or asof
        if r.exit is None:
            elapsed = len([d for d in trading_days if r.entry < d <= asof])
            if elapsed < min_open_days:
                continue
        sr, br = _window_return(s, r.entry, end), _window_return(tri, r.entry, end)
        if sr is None or br is None:
            continue
        win = sr > br
        if r.exit is not None:
            realized_t += 1; realized_w += win
        else:
            open_t += 1; open_w += win
    return {"picking_realized_wins": realized_w, "picking_realized_total": realized_t,
            "picking_open_wins": open_w, "picking_open_total": open_t}

def picking_win_rate(etf_id: str, today: dt.date, tri: Series) -> dict:
    with db.conn() as c:
        events = c.execute("""
            select hc.trade_date, hc.stock_id, hc.change_type, hc.shares_delta,
                   coalesce(hs.shares, 0)
            from holding_change hc
            left join holdings_snapshot hs
              on hs.etf_id = hc.etf_id and hs.stock_id = hc.stock_id
             and hs.trade_date = (select max(trade_date) from holdings_snapshot
                                  where etf_id = hc.etf_id and stock_id = hc.stock_id
                                    and trade_date < hc.trade_date)
            where hc.etf_id = %s""", (etf_id,)).fetchall()
    rounds = build_rounds([tuple(e) for e in events])
    tw_ids = db.known_stock_ids()
    needed = {r.stock_id for r in rounds if r.stock_id in tw_ids}
    series = {sid: load_adj_series(sid, min((r.entry for r in rounds), default=today), today)
              for sid in needed}
    return score_rounds(rounds, series, tri, today)

def style_metrics(etf_id: str, today: dt.date) -> dict:
    """中位持有天數（已平倉回合）與週換手率（近 5 交易日新進+出清 / 平均持股數）。"""
    with db.conn() as c:
        rounds = c.execute("""
            select n.stock_id, n.trade_date as entry,
                   (select min(trade_date) from holding_change x
                    where x.etf_id = n.etf_id and x.stock_id = n.stock_id
                      and x.change_type = 'EXIT' and x.trade_date > n.trade_date) as exit
            from holding_change n
            where n.etf_id = %s and n.change_type = 'NEW'""", (etf_id,)).fetchall()
        held = [r for r in rounds if r[2] is not None]
        durations = sorted((r[2] - r[1]).days for r in held)
        recent = c.execute("""
            select count(*) from holding_change
            where etf_id = %s and change_type in ('NEW','EXIT')
              and trade_date > %s""", (etf_id, today - dt.timedelta(days=7))).fetchone()[0]
        avg_count = c.execute("""
            select avg(cnt) from (select count(*) cnt from holdings_snapshot
            where etf_id = %s group by trade_date order by trade_date desc limit 5) t""",
            (etf_id,)).fetchone()[0]
    median = durations[len(durations) // 2] if durations else None
    turnover = float(recent) / float(avg_count) * 100 if avg_count else None
    return {"median_holding_days": median, "weekly_turnover_pct": turnover}
```

- [x] **Step 4: 確認通過** → `uv run pytest tests/test_metrics_picking.py -v` → PASS，並跑全套 `uv run pytest -v` → 29 passed
- [x] **Step 5: 移除 Task 11 pipeline 中 `metrics.compute_all` 的佔位（若有）**
- [x] **Step 6: Commit** → `git commit -m "feat: 選股勝率（回合制）與操作風格指標"`

---

### Task 15: backfill — 一次性股價回補 ⚠️ 腳本與測試完成，真執行待 DB 與還原價權限

**Files:** Create: `scraper/scripts/backfill.py`

- [x] **Step 1: 實作**

```python
# scripts/backfill.py
"""上線首日跑一次（spec §8）：回補全部 ETF + 0050 + 加權報酬指數的還原價，
讓報酬與擇時勝率第一天就能算。用量約 30 次呼叫，遠低於 600/hr。"""
import datetime as dt
import time
from activeetf import db, finmind
from activeetf.registry import entries

START = "2025-05-01"   # 首檔主動式 ETF 上市月
TODAY = str(dt.date.today())

targets = [e.etf_id for e in entries()] + ["0050"]
for sid in targets:
    rows = finmind.adj_prices(sid, START, TODAY)
    db.upsert_prices([(r["stock_id"], r["date"], None, r["close"]) for r in rows])
    print(f"{sid}: {len(rows)} rows")
    time.sleep(1)

tri = finmind.total_return_index(START, TODAY)
db.upsert_prices([(finmind.TAIEX_TRI, r["date"], None, r["price"]) for r in tri])
print(f"TAIEX_TRI: {len(tri)} rows")
```

- [ ] **Step 2: 執行並驗證** — 待 `SUPABASE_DB_URL`，且目前 `TaiwanStockPriceAdj` 受 FinMind 帳號等級阻擋

```bash
uv run python scripts/backfill.py
psql "$SUPABASE_DB_URL" -c "select stock_id, count(*) from stock_price group by 1 order by 1 limit 40"
```

Expected: 每檔 ETF 依上市日有數十到 200+ 筆；0050 與 TAIEX_TRI 約 280+ 筆。
- [x] **Step 3: Commit** → `git commit -m "feat: 股價一次性回補腳本"`

---

### Task 16: GitHub Actions 排程 ⚠️ workflow 已寫入，遠端驗證待 GitHub secrets

**Files:** Create: `.github/workflows/daily.yml`

- [x] **Step 1: 寫 workflow**

```yaml
# .github/workflows/daily.yml
name: daily-pipeline
on:
  schedule:
    - cron: '30 10 * * 1-5'   # 台北 18:30 主場（UTC+8）
    - cron: '30 13 * * 1-5'   # 台北 21:30 補抓場
  workflow_dispatch:           # 手動觸發（除錯用）

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - name: Run pipeline
        working-directory: scraper
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
          FINMIND_TOKEN: ${{ secrets.FINMIND_TOKEN }}
        run: uv run python -m activeetf.pipeline
      - name: Alert on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner, repo: context.repo.repo,
              title: `pipeline 失敗 ${new Date().toISOString().slice(0,10)}`,
              body: `Run: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
            });
```

- [ ] **Step 2: 推上 GitHub 後手動觸發驗證** — 待 GitHub secrets / push 後驗證

```bash
git add .github && git commit -m "feat: GitHub Actions 每日排程（18:30/21:30 台北）"
git push
gh workflow run daily-pipeline && sleep 60 && gh run list --workflow daily-pipeline --limit 1
```

Expected: run 成功；`psql` 查 `scrape_log` 有當日紀錄。
- [ ] **Step 3: 在 Actions 環境跑一次 probe 比對本機結果（確認海外 IP 是否被擋）** — 待 GitHub Actions 環境

臨時在 workflow 加一個 step `run: uv run python scripts/probe.py`，`workflow_dispatch` 觸發一次，比對輸出後移除該 step。被擋的投信在 registry 註記，依 spec §5 備案處理（代理或本機排程）。

---

## 驗收清單（全計畫完成的定義）

- [ ] `uv run pytest` 全綠
- [ ] 連續 3 個交易日 GitHub Actions 自動跑成功，`holdings_snapshot` 每日有全部已實作 ETF 的資料
- [ ] `holding_change` 出現的異動與 zdsetf.com / etfinfo.tw 抽查 3 檔比對一致（spec §2 對照組）
- [ ] `etf_metrics` 的報酬抽查 1 檔與投信官網月報酬誤差 < 1pp
- [ ] 失敗告警驗證過一次（手動弄壞一個 adapter URL 觸發 Issue）

## Self-review 紀錄

- Spec 覆蓋：§3 架構（Task 11/16）、§4 模型（Task 2）、§5 爬蟲（Task 4/5/8–12）、§6 指標（Task 13/14）、§8 部署（Task 15/16）、§9 錯誤處理（Task 11 隔離/冪等、Task 16 告警）。§7 Dashboard 屬 Plan B，不在本計畫。
- 已知妥協：Task 12 各家解析程式碼無法預寫（需實地 fixture），以固定四步流程替代——這是本計畫唯一的「流程式」任務，其餘任務皆含完整程式碼。
- 型別一致性：`Holding`/`Change`/`EtfEntry` 簽名在 Task 3/8 定義後，Task 4/5/10/11 引用一致；`picking_win_rate`/`style_metrics` 回傳 dict 鍵與 Task 2 `etf_metrics` 欄位名一致。
