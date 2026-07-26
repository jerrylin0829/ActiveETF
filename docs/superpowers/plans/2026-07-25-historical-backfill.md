# 歷史 PCF 回補 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依 `docs/superpowers/specs/2026-07-25-historical-backfill-design.md`，為 6 家支援歷史查詢的投信加上 `fetch_at(entry, date)` 可選能力，讓 12 檔 ETF 從上市日起逐交易日嘗試回補、僅寫入通過驗證的日期，重算衍生表，並在前端誠實揭露各檔最早可用歷史日。

> **2026-07-26 Evaluator 修訂（優先於下方原始 Task 8 程式片段）**：00990A 2025-12-15 的 50.80% 股票曝險維持 validation failure，不另訂 global ETF 例外；腳本統計分列已有快照、validation failure、fetch failure。`holding_change` 的 snapshot read 與 replace 改為同 transaction，依序鎖 `holdings_snapshot`、`holding_change`，並補真 DB rollback test。Dashboard 的有限 `scrape_log` 查詢改依 `trade_date DESC, run_at DESC, id DESC`，避免歷史回補紀錄排擠近期告警。

**Architecture:** `fetch_at` 為**可選能力**——只有支援的 adapter 實作，回補腳本以 `supports_history()` 偵測，每日 pipeline 的 `fetch(entry)` 完全不動。回補腳本按時間正序、跳過已有快照（天然冪等即續跑），三道驗證不放寬。快照入庫後衍生表全部重算（append-only 事實來源的設計在此兌現）。

**Tech Stack:** Python 3 + requests + psycopg（scraper）、Postgres view、Next.js（web）、pytest / Vitest。

**PR 切分：** Task 1–8 = PR「歷史回補能力」（adapter + 腳本）；Task 9–11 = PR「揭露與重算」（view + 前端）。回補**執行**由 User 或授權 session 進行，不在 PR 內。

**通用約定：** scraper 指令在 `scraper/` 下；web 指令在 `web/` 下；分支 `codex/historical-backfill`；commit 格式 `type: 中文描述`；**不對正式 DB 執行語句**；**不對投信官網發測試請求**（測試一律用 fixture）。

**各家日期格式（Planner 2026-07-25 實測確認，勿自行更動）：**

| adapter | 參數 | 格式 | 範例 |
|---|---|---|---|
| uni | `date` + `specificDate: True` | 民國 `NNN/MM/DD` | `115/06/15` |
| yuanta | `ndate` | `YYYYMMDD` | `20260615` |
| cathay | `SearchDate` | ISO | `2026-06-15` |
| fsitc | `pStrDate` | `YYYY/MM/DD` | `2026/06/15` |
| allianz | `Date` | ISO | `2026-06-15` |
| ctbc | `StartDate` | ISO；**token 需同時放 query string 與 body** | `2026-06-15` |

---

### Task 1: `supports_history()` 能力偵測（TDD）

**Files:**
- Modify: `scraper/src/activeetf/adapters/base.py`
- Test: `scraper/tests/test_adapter_base.py`

- [ ] **Step 1: 寫失敗測試**

建立 `scraper/tests/test_adapter_base.py`：

```python
import types
from activeetf.adapters import base


def test_supports_history_true_when_fetch_at_defined():
    module = types.SimpleNamespace(fetch_at=lambda entry, date: [])
    assert base.supports_history(module) is True


def test_supports_history_false_when_absent():
    module = types.SimpleNamespace(fetch=lambda entry: [])
    assert base.supports_history(module) is False


def test_supports_history_false_when_not_callable():
    module = types.SimpleNamespace(fetch_at="not a function")
    assert base.supports_history(module) is False
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run pytest tests/test_adapter_base.py -v`
Expected: FAIL — `AttributeError: module 'activeetf.adapters.base' has no attribute 'supports_history'`

- [ ] **Step 3: 實作**

在 `scraper/src/activeetf/adapters/base.py` 檔尾新增（`import datetime as dt` 加到檔頭 import 區）：

```python
class HistoricalAdapter(Protocol):
    """可選能力：支援指定歷史日期抓取。僅部分投信的上游 API 提供。"""
    def fetch_at(self, entry: EtfEntry, date: dt.date) -> list[Holding]: ...


def supports_history(module) -> bool:
    """該 adapter 是否能抓指定歷史日期。回補腳本用此判斷是否跳過。"""
    return callable(getattr(module, "fetch_at", None))
```

- [ ] **Step 4: 跑測試確認通過**

Run: `uv run pytest tests/test_adapter_base.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/activeetf/adapters/base.py tests/test_adapter_base.py
git commit -m "feat: adapter 歷史抓取能力偵測"
```

---

### Task 2: 統一 `fetch_at`（TDD）

**Files:**
- Modify: `scraper/src/activeetf/adapters/uni.py`
- Test: `scraper/tests/test_adapter_uni.py`

- [ ] **Step 1: 寫失敗測試**

在 `scraper/tests/test_adapter_uni.py` 檔尾新增（用 monkeypatch 攔截 session，不發真實請求）：

```python
import datetime as dt
from activeetf.adapters import uni
from activeetf.registry import EtfEntry

_ENTRY = EtfEntry("00981A", "主動統一台股增長", "統一", "tw", "http://x", "uni")


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload
    def raise_for_status(self):
        pass
    def json(self):
        return self._payload


def test_fetch_at_sends_roc_date_and_specific_flag(monkeypatch):
    captured = {}

    class _FakeSession:
        def get(self, *a, **kw):
            return _FakeResponse({})
        def post(self, url, json=None, headers=None, timeout=None):
            captured.update(json)
            return _FakeResponse({"asset": [{"AssetCode": "ST", "Details": [
                {"DetailCode": "2330", "Share": "1000", "NavRate": "5.5"}]}]})

    monkeypatch.setattr(uni.requests, "Session", lambda: _FakeSession())
    holdings = uni.fetch_at(_ENTRY, dt.date(2026, 6, 15))

    assert captured["date"] == "115/06/15"      # 民國年，三位數補零
    assert captured["specificDate"] is True      # 關鍵開關：False 會回最新日
    assert captured["fundCode"] == uni._FUND_CODES["00981A"]
    assert holdings[0].stock_id == "2330"
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run pytest tests/test_adapter_uni.py::test_fetch_at_sends_roc_date_and_specific_flag -v`
Expected: FAIL — `AttributeError: module 'activeetf.adapters.uni' has no attribute 'fetch_at'`

- [ ] **Step 3: 實作**

`scraper/src/activeetf/adapters/uni.py`：把既有 `_roc_today()` 旁邊加一個接受任意日期的版本，並新增 `fetch_at`。`fetch()` 改為委派，避免兩份請求邏輯：

```python
def _roc(date: dt.date) -> str:
    return f"{date.year - 1911:03d}/{date.month:02d}/{date.day:02d}"


def _fetch_pcf(entry: EtfEntry, date: dt.date | None) -> list[Holding]:
    """date=None 取最新一日；給定日期則查該歷史日（specificDate 開關）。"""
    session = requests.Session()
    response = session.get(_PCF_PAGE, headers=UA, timeout=30, allow_redirects=False)
    if response.is_redirect:
        response = session.get(_PCF_PAGE, headers=UA, timeout=30, allow_redirects=False)
    response.raise_for_status()

    target = date or datetime.now(ZoneInfo("Asia/Taipei")).date()
    response = session.post(
        _PCF_API,
        json={
            "fundCode": _FUND_CODES[entry.etf_id],
            "date": _roc(target),
            "specificDate": date is not None,
        },
        headers=UA,
        timeout=30,
    )
    response.raise_for_status()
    return parse(response.json())


def fetch(entry: EtfEntry) -> list[Holding]:
    return _fetch_pcf(entry, None)


def fetch_at(entry: EtfEntry, date: dt.date) -> list[Holding]:
    return _fetch_pcf(entry, date)
```

檔頭 import 改為 `import datetime as dt` 並保留 `from datetime import datetime`；移除已被 `_roc` 取代的 `_roc_today()`。

- [ ] **Step 4: 跑測試確認通過**

Run: `uv run pytest tests/test_adapter_uni.py -v`
Expected: 全 PASS（含既有測試——`fetch()` 行為未變）

- [ ] **Step 5: Commit**

```bash
git add src/activeetf/adapters/uni.py tests/test_adapter_uni.py
git commit -m "feat: 統一 adapter 支援歷史日期抓取"
```

---

### Task 3: 元大 `fetch_at`（TDD）

**Files:**
- Modify: `scraper/src/activeetf/adapters/yuanta.py`
- Test: `scraper/tests/test_adapter_yuanta.py`

- [ ] **Step 1: 寫失敗測試**

在 `scraper/tests/test_adapter_yuanta.py` 檔尾新增：

```python
import datetime as dt
from activeetf.adapters import yuanta
from activeetf.registry import EtfEntry

_ENTRY_Y = EtfEntry("00990A", "主動元大AI新經濟", "元大", "global", "http://x", "yuanta")


def test_fetch_at_sends_compact_date(monkeypatch):
    captured = {}

    class _Resp:
        def raise_for_status(self): pass
        def json(self):
            return {"FundWeights": {"StockWeights": [
                {"code": "2330", "qty": "1000", "weights": "5.5"}]}}

    def _fake_get(url, headers=None, params=None, timeout=None):
        captured.update(params)
        return _Resp()

    monkeypatch.setattr(yuanta.requests, "get", _fake_get)
    holdings = yuanta.fetch_at(_ENTRY_Y, dt.date(2026, 6, 15))

    assert captured["ndate"] == "20260615"   # 緊湊格式，無分隔符
    assert captured["ticker"] == "00990A"
    assert holdings[0].stock_id == "2330"
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run pytest tests/test_adapter_yuanta.py::test_fetch_at_sends_compact_date -v`
Expected: FAIL — no attribute `fetch_at`

- [ ] **Step 3: 實作**

`scraper/src/activeetf/adapters/yuanta.py`：把 `fetch` 的 params 建構抽出，`ndate` 空字串代表最新日：

```python
def _params(entry: EtfEntry, date: dt.date | None) -> dict:
    return {
        "APIType": "ETFAPI",
        "CompanyName": "YUANTAFUNDS",
        "PageName": f"/tradeInfo/pcf/{entry.etf_id}",
        "DeviceId": "null",
        "FuncId": "PCF/Daily",
        "AppName": "ETF",
        "Device": "3",
        "Platform": "ETF",
        "ticker": entry.etf_id,
        "ndate": date.strftime("%Y%m%d") if date else "",
    }


def _fetch_pcf(entry: EtfEntry, date: dt.date | None) -> list[Holding]:
    response = requests.get(_API_URL, headers=UA, params=_params(entry, date), timeout=30)
    response.raise_for_status()
    return parse(response.json())


def fetch(entry: EtfEntry) -> list[Holding]:
    return _fetch_pcf(entry, None)


def fetch_at(entry: EtfEntry, date: dt.date) -> list[Holding]:
    return _fetch_pcf(entry, date)
```

檔頭加 `import datetime as dt`。

- [ ] **Step 4: 跑測試確認通過**

Run: `uv run pytest tests/test_adapter_yuanta.py -v`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add src/activeetf/adapters/yuanta.py tests/test_adapter_yuanta.py
git commit -m "feat: 元大 adapter 支援歷史日期抓取"
```

---

### Task 4: 國泰、第一金 `fetch_at`（TDD）

**Files:**
- Modify: `scraper/src/activeetf/adapters/cathay.py`、`scraper/src/activeetf/adapters/fsitc.py`
- Test: `scraper/tests/test_adapter_cathay.py`、`scraper/tests/test_adapter_fsitc.py`

- [ ] **Step 1: 寫失敗測試（國泰）**

在 `scraper/tests/test_adapter_cathay.py` 檔尾新增（沿用該檔既有的 xlsx fixture 建構方式；若既有測試有 `_workbook_bytes()` 之類 helper 就重用，否則以既有測試中的 xlsx bytes 常數為準）：

```python
import datetime as dt
from activeetf.adapters import cathay
from activeetf.registry import EtfEntry

_ENTRY_C = EtfEntry("00400A", "主動國泰動能高息", "國泰", "tw", "http://x", "cathay")


def test_fetch_at_uses_iso_search_date(monkeypatch):
    captured = {}

    class _Resp:
        content = b""
        def raise_for_status(self): pass

    def _fake_get(url, params=None, headers=None, timeout=None):
        captured["url"] = url
        captured.update(params or {})
        return _Resp()

    monkeypatch.setattr(cathay.requests, "get", _fake_get)
    monkeypatch.setattr(cathay, "parse_xlsx", lambda content: [])

    cathay.fetch_at(_ENTRY_C, dt.date(2026, 6, 15))

    assert captured["SearchDate"] == "2026-06-15"        # ISO 格式
    assert captured["FundCode"] == cathay._FUND_CODES["00400A"]
    assert "GetETFInfoMain" not in captured["url"]        # 指定日期時不需先查 navDate
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run pytest tests/test_adapter_cathay.py::test_fetch_at_uses_iso_search_date -v`
Expected: FAIL — no attribute `fetch_at`

- [ ] **Step 3: 實作（國泰）**

`scraper/src/activeetf/adapters/cathay.py`：抽出下載步驟，`fetch` 先查 `navDate`、`fetch_at` 直接用給定日期：

```python
def _download(fund_code: str, search_date: str) -> list[Holding]:
    workbook = requests.get(
        f"{_API_BASE}/DownloadETFWeightExcel",
        params={"FundCode": fund_code, "SearchDate": search_date, "status": 1},
        headers=UA,
        timeout=30,
    )
    workbook.raise_for_status()
    return parse_xlsx(workbook.content)


def fetch_at(entry: EtfEntry, date: dt.date) -> list[Holding]:
    return _download(_FUND_CODES[entry.etf_id], date.isoformat())
```

既有 `fetch()` 內下載工作簿的部分改為呼叫 `_download(fund_code, nav_date)`，查 `navDate` 的邏輯保留不動。檔頭加 `import datetime as dt`。

- [ ] **Step 4: 寫失敗測試（第一金）**

在 `scraper/tests/test_adapter_fsitc.py` 檔尾新增：

```python
import datetime as dt
from activeetf.adapters import fsitc
from activeetf.registry import EtfEntry

_ENTRY_F = EtfEntry("00994A", "主動第一金", "第一金", "tw",
                    "https://www.fsitc.com.tw/FundDetail.aspx?ID=182", "fsitc")


def test_fetch_at_uses_slash_date(monkeypatch):
    captured = {}

    class _Resp:
        def raise_for_status(self): pass
        def json(self): return {"d": "[]"}

    def _fake_post(url, json=None, headers=None, timeout=None):
        captured.update(json)
        return _Resp()

    monkeypatch.setattr(fsitc.requests, "post", _fake_post)
    fsitc.fetch_at(_ENTRY_F, dt.date(2026, 6, 15))

    assert captured["pStrDate"] == "2026/06/15"   # 斜線格式
    assert captured["pStrFundID"] == "182"
```

- [ ] **Step 5: 跑測試確認失敗**

Run: `uv run pytest tests/test_adapter_fsitc.py::test_fetch_at_uses_slash_date -v`
Expected: FAIL — no attribute `fetch_at`

- [ ] **Step 6: 實作（第一金）**

`scraper/src/activeetf/adapters/fsitc.py`：

```python
def _fetch_pcf(entry: EtfEntry, date: dt.date | None) -> list[Holding]:
    if not entry.pcf_url:
        raise ValueError("pcf_url is required")
    r = requests.post(
        urljoin(entry.pcf_url, "WebAPI.aspx/Get_hd"),
        json={
            "pStrFundID": _fund_id(entry.pcf_url),
            "pStrDate": date.strftime("%Y/%m/%d") if date else "",
        },
        headers={**UA, "Referer": entry.pcf_url},
        timeout=30,
    )
    r.raise_for_status()
    return parse(r.json())


def fetch(entry: EtfEntry) -> list[Holding]:
    return _fetch_pcf(entry, None)


def fetch_at(entry: EtfEntry, date: dt.date) -> list[Holding]:
    return _fetch_pcf(entry, date)
```

檔頭加 `import datetime as dt`。

- [ ] **Step 7: 跑測試確認通過**

Run: `uv run pytest tests/test_adapter_cathay.py tests/test_adapter_fsitc.py -v`
Expected: 全 PASS

- [ ] **Step 8: Commit**

```bash
git add src/activeetf/adapters/cathay.py src/activeetf/adapters/fsitc.py tests/test_adapter_cathay.py tests/test_adapter_fsitc.py
git commit -m "feat: 國泰與第一金 adapter 支援歷史日期抓取"
```

---

### Task 5: 安聯、中信 `fetch_at`（TDD）

**Files:**
- Modify: `scraper/src/activeetf/adapters/allianz.py`、`scraper/src/activeetf/adapters/ctbc.py`
- Test: `scraper/tests/test_adapter_allianz.py`、`scraper/tests/test_adapter_ctbc.py`

- [ ] **Step 1: 寫失敗測試（安聯）**

在 `scraper/tests/test_adapter_allianz.py` 檔尾新增：

```python
import datetime as dt
from activeetf.adapters import allianz
from activeetf.registry import EtfEntry

_ENTRY_A = EtfEntry("00402A", "主動安聯", "安聯", "global",
                    "https://etf.allianzgi.com.tw/list-trade", "allianz")


def test_fetch_at_sends_iso_date(monkeypatch):
    captured = {}

    class _Resp:
        def raise_for_status(self): pass
        def json(self): return {"Entries": {"DynamicTableData": []}}

    class _FakeSession:
        cookies = {"X-XSRF-TOKEN": "tok"}
        def get(self, *a, **kw): return _Resp()
        def post(self, url, headers=None, json=None, timeout=None):
            captured.update(json)
            return _Resp()

    monkeypatch.setattr(allianz.requests, "Session", lambda: _FakeSession())
    allianz.fetch_at(_ENTRY_A, dt.date(2026, 6, 15))

    assert captured["Date"] == "2026-06-15"     # ISO；fetch() 為 None
    assert captured["FundNo"] == allianz._FUND_IDS["00402A"]
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run pytest tests/test_adapter_allianz.py::test_fetch_at_sends_iso_date -v`
Expected: FAIL — no attribute `fetch_at`

- [ ] **Step 3: 實作（安聯）**

`scraper/src/activeetf/adapters/allianz.py`：把既有 `fetch()` 主體抽成 `_fetch_pcf(entry, date)`，唯一差別是 body 的 `"Date"` 由 `None` 改為 `date.isoformat() if date else None`：

```python
def _fetch_pcf(entry: EtfEntry, date: dt.date | None) -> list[Holding]:
    session = requests.Session()
    headers = {**UA, "Origin": _ORIGIN,
               "Referer": entry.pcf_url or f"{_ORIGIN}/list-trade"}
    response = session.get(f"{_API_BASE}/AntiForgery/GetAntiForgeryToken",
                           headers=headers, timeout=30)
    response.raise_for_status()
    xsrf_token = session.cookies["X-XSRF-TOKEN"]
    response = session.post(
        f"{_API_BASE}/Fund/GetFundTradeInfo",
        headers={**headers, "Content-Type": "application/json",
                 "X-XSRF-TOKEN": xsrf_token},
        json={"FundNo": _FUND_IDS[entry.etf_id],
              "Date": date.isoformat() if date else None},
        timeout=30,
    )
    response.raise_for_status()
    return parse(response.json())


def fetch(entry: EtfEntry) -> list[Holding]:
    return _fetch_pcf(entry, None)


def fetch_at(entry: EtfEntry, date: dt.date) -> list[Holding]:
    return _fetch_pcf(entry, date)
```

檔頭加 `import datetime as dt`。

- [ ] **Step 4: 寫失敗測試（中信）**

在 `scraper/tests/test_adapter_ctbc.py` 檔尾新增。**注意：token 必須同時出現在 query string 與 body**——Planner 探測時漏了 query string 導致回空、誤判該家不支援歷史：

```python
import datetime as dt
from activeetf.adapters import ctbc
from activeetf.registry import EtfEntry

_ENTRY_T = EtfEntry("00406A", "主動中信", "中信", "tw", "http://x", "ctbc")


def test_fetch_at_sends_token_in_both_places(monkeypatch):
    captured = {}

    class _Resp:
        def raise_for_status(self): pass
        def json(self):
            return {"ResultCode": 0, "Data": {"token": "tok", "Detail": []}}

    def _fake_post(url, params=None, json=None, headers=None, timeout=None):
        if "Buyback" in url:
            captured["params"] = params or {}
            captured["body"] = json or {}
        return _Resp()

    monkeypatch.setattr(ctbc.requests, "post", _fake_post)
    ctbc.fetch_at(_ENTRY_T, dt.date(2026, 6, 15))

    assert captured["body"]["StartDate"] == "2026-06-15"
    assert captured["params"]["token"] == "tok"   # query string 缺 token 會回空
    assert captured["body"]["token"] == "tok"
```

- [ ] **Step 5: 跑測試確認失敗**

Run: `uv run pytest tests/test_adapter_ctbc.py::test_fetch_at_sends_token_in_both_places -v`
Expected: FAIL — no attribute `fetch_at`

- [ ] **Step 6: 實作（中信）**

`scraper/src/activeetf/adapters/ctbc.py`：把既有 `fetch()` 主體抽成 `_fetch_pcf(entry, date)`，`StartDate` 由 `dt.date.today()` 改為 `date or dt.date.today()`，其餘（含 `params={"token": token}`）保持不變：

```python
def _fetch_pcf(entry: EtfEntry, date: dt.date | None) -> list[Holding]:
    headers = {**UA, "content-type": "application/json; charset=utf-8"}
    token_response = requests.post(
        f"{_API_BASE}/home/AuthToken",
        params={"token": _TOKEN_SEED}, json={"token": _TOKEN_SEED},
        headers=headers, timeout=30,
    )
    token_response.raise_for_status()
    token = _data(token_response)["token"]

    response = requests.post(
        f"{_API_BASE}/etf/Buyback",
        params={"token": token},   # 缺此參數上游回空，勿移除
        json={"token": token, "FID": _FUND_IDS[entry.etf_id],
              "StartDate": (date or dt.date.today()).isoformat()},
        headers=headers, timeout=30,
    )
    response.raise_for_status()
    return parse(_data(response))


def fetch(entry: EtfEntry) -> list[Holding]:
    return _fetch_pcf(entry, None)


def fetch_at(entry: EtfEntry, date: dt.date) -> list[Holding]:
    return _fetch_pcf(entry, date)
```

- [ ] **Step 7: 跑全套測試確認通過**

Run: `uv run pytest`
Expected: 全 PASS（無 `SUPABASE_DB_URL` 時整合測試自動 skip）

- [ ] **Step 8: Commit**

```bash
git add src/activeetf/adapters/allianz.py src/activeetf/adapters/ctbc.py tests/test_adapter_allianz.py tests/test_adapter_ctbc.py
git commit -m "feat: 安聯與中信 adapter 支援歷史日期抓取"
```

---

### Task 6: 回補目標清單純函式（TDD）

**Files:**
- Create: `scraper/src/activeetf/backfill.py`
- Test: `scraper/tests/test_backfill_history.py`

- [ ] **Step 1: 寫失敗測試**

建立 `scraper/tests/test_backfill_history.py`：

```python
import datetime as dt
from activeetf.backfill import backfill_targets

D = dt.date


def test_only_dates_on_or_after_listing():
    targets = backfill_targets(
        trading_dates=[D(2026, 6, 1), D(2026, 6, 2), D(2026, 6, 3)],
        listing_dates={"00981A": D(2026, 6, 2)},
        existing={},
    )
    assert [d for _, d in targets] == [D(2026, 6, 2), D(2026, 6, 3)]


def test_skips_dates_already_in_snapshot():
    targets = backfill_targets(
        trading_dates=[D(2026, 6, 1), D(2026, 6, 2)],
        listing_dates={"00981A": D(2026, 6, 1)},
        existing={("00981A", D(2026, 6, 1))},
    )
    assert targets == [("00981A", D(2026, 6, 2))]


def test_chronological_order_per_etf():
    """按時間正序：三道驗證的『筆數 vs 前日』需要前一日已入庫。"""
    targets = backfill_targets(
        trading_dates=[D(2026, 6, 3), D(2026, 6, 1), D(2026, 6, 2)],
        listing_dates={"00981A": D(2026, 6, 1)},
        existing={},
    )
    dates = [d for etf, d in targets if etf == "00981A"]
    assert dates == sorted(dates)


def test_rotates_between_etfs_to_avoid_hammering_one_host():
    targets = backfill_targets(
        trading_dates=[D(2026, 6, 1), D(2026, 6, 2)],
        listing_dates={"00981A": D(2026, 6, 1), "00990A": D(2026, 6, 1)},
        existing={},
    )
    # 同一日的不同 ETF 相鄰，而非同一 ETF 連續打完所有日期
    assert [e for e, _ in targets] == ["00981A", "00990A", "00981A", "00990A"]
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run pytest tests/test_backfill_history.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'activeetf.backfill'`

- [ ] **Step 3: 實作**

建立 `scraper/src/activeetf/backfill.py`：

```python
"""歷史回補的純邏輯：決定要抓哪些 (etf_id, date)。

不碰網路與 DB——呼叫端負責取得 trading_dates / listing_dates / existing。
"""
import datetime as dt


def backfill_targets(
    trading_dates: list[dt.date],
    listing_dates: dict[str, dt.date],
    existing: set[tuple[str, dt.date]],
) -> list[tuple[str, dt.date]]:
    """回傳待抓清單，依日期正序、同日內依 etf_id 輪替。

    - 只納入 >= 該 ETF 上市日的交易日
    - 已存在於 holdings_snapshot 的 (etf, date) 直接跳過（冪等／續跑）
    - 依日期正序：三道驗證的「筆數 vs 前日無突變」需前一日先入庫
    - 同日內輪替不同 ETF：避免對單一投信站台連續請求
    """
    targets: list[tuple[str, dt.date]] = []
    for date in sorted(trading_dates):
        for etf_id in sorted(listing_dates):
            if date < listing_dates[etf_id]:
                continue
            if (etf_id, date) in existing:
                continue
            targets.append((etf_id, date))
    return targets
```

- [ ] **Step 4: 跑測試確認通過**

Run: `uv run pytest tests/test_backfill_history.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/activeetf/backfill.py tests/test_backfill_history.py
git commit -m "feat: 歷史回補目標清單計算"
```

---

### Task 7: DB 查詢輔助（TDD，整合測試）

**Files:**
- Modify: `scraper/src/activeetf/db.py`
- Test: `scraper/tests/test_backfill_history_db.py`

- [ ] **Step 1: 寫失敗的整合測試**

建立 `scraper/tests/test_backfill_history_db.py`（比照既有整合測試慣例：`_T` 假代號、遠古日期、無 env 自動 skip、setup 前 + teardown 後雙清理）：

```python
import os, datetime as dt
import pytest
from activeetf.models import Holding
from activeetf import db

pytestmark = pytest.mark.skipif(not os.environ.get("SUPABASE_DB_URL"),
                                reason="needs SUPABASE_DB_URL")

D1, D2 = dt.date(2000, 2, 1), dt.date(2000, 2, 2)


def _wipe():
    with db.conn() as c:
        for d in (D1, D2):
            c.execute("delete from holdings_snapshot where trade_date = %s", (d,))
            c.execute("delete from stock_price where trade_date = %s", (d,))
        c.execute("delete from stock_info where stock_id = '_T91'")
        c.execute("delete from etf where etf_id = '_TA'")


@pytest.fixture(autouse=True)
def _seed():
    _wipe()
    with db.conn() as c:
        c.execute("insert into etf (etf_id, name, issuer) values ('_TA','a','x')")
        c.execute("insert into stock_info (stock_id, name, industry, market) "
                  "values ('_T91','alpha','水泥工業','twse')")
    db.write_snapshot("_TA", D1, [Holding("_T91", 1000, 5.0)])
    yield
    _wipe()


def test_existing_snapshot_keys_returns_written_pairs():
    keys = db.existing_snapshot_keys(["_TA"])
    assert ("_TA", D1) in keys
    assert ("_TA", D2) not in keys


def test_etf_listing_dates_uses_earliest_price_date():
    with db.conn() as c:
        c.execute("insert into stock_price (stock_id, trade_date, close, adj_close) "
                  "values ('_TA', %s, 10, 10), ('_TA', %s, 11, 11)", (D2, D1))
    assert db.etf_listing_dates(["_TA"])["_TA"] == D1
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `set -a && source .env.local && set +a && uv run pytest tests/test_backfill_history_db.py -v`
Expected: FAIL — `AttributeError: module 'activeetf.db' has no attribute 'existing_snapshot_keys'`

- [ ] **Step 3: 實作**

在 `scraper/src/activeetf/db.py` 檔尾新增：

```python
def existing_snapshot_keys(etf_ids: list[str]) -> set[tuple[str, dt.date]]:
    """已入庫的 (etf_id, trade_date)，供回補跳過——冪等與續跑的依據。"""
    with conn() as c:
        rows = c.execute(
            """select distinct etf_id, trade_date from holdings_snapshot
               where etf_id = any(%s)""", (etf_ids,)).fetchall()
    return {(r[0], r[1]) for r in rows}


def etf_listing_dates(etf_ids: list[str]) -> dict[str, dt.date]:
    """各 ETF 最早有價格的交易日，作為上市日近似值——回補不早於此日。"""
    with conn() as c:
        rows = c.execute(
            """select stock_id, min(trade_date) from stock_price
               where stock_id = any(%s) and adj_close is not null
               group by stock_id""", (etf_ids,)).fetchall()
    return {r[0]: r[1] for r in rows}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `set -a && source .env.local && set +a && uv run pytest tests/test_backfill_history_db.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/activeetf/db.py tests/test_backfill_history_db.py
git commit -m "feat: 回補所需的快照與上市日查詢"
```

---

### Task 8: 回補腳本

**Files:**
- Create: `scraper/scripts/backfill_history.py`

- [ ] **Step 1: 實作腳本**

建立 `scraper/scripts/backfill_history.py`：

```python
"""One-off 歷史 PCF 回補（spec 2026-07-25）。

只處理實作了 fetch_at 的 adapter；其餘自動跳過並列於報告。
按日期正序、同日輪替不同投信；已有快照直接跳過（中斷可續跑）。
三道驗證不放寬——不過即跳過該日並記 scrape_log。

Usage:  set -a && source .env.local && set +a
        uv run python scripts/backfill_history.py
"""
import time
import traceback

from activeetf import db, metrics
from activeetf.adapters import base as adapter_base
from activeetf.backfill import backfill_targets
from activeetf.diff import diff_snapshots
from activeetf.registry import entries
from activeetf.validate import validate

PAUSE_SECONDS = 2.0


def main() -> None:
    supported, skipped = {}, []
    for entry in entries():
        if not entry.adapter:
            continue
        module = adapter_base.load(entry.adapter)
        if adapter_base.supports_history(module):
            supported[entry.etf_id] = (entry, module)
        else:
            skipped.append(f"{entry.etf_id}({entry.adapter})")

    print(f"支援歷史回補：{len(supported)} 檔 → {sorted(supported)}")
    print(f"不支援（上游無日期參數）：{len(skipped)} 檔 → {skipped}\n")
    if not supported:
        return

    etf_ids = sorted(supported)
    listing = db.etf_listing_dates(etf_ids)
    missing_listing = [e for e in etf_ids if e not in listing]
    if missing_listing:
        print(f"⚠️ 無價格資料、無法推得上市日，略過：{missing_listing}")
    trading_dates = db.snapshot_trading_dates(max(listing.values()))
    targets = backfill_targets(trading_dates, listing, db.existing_snapshot_keys(etf_ids))
    print(f"待抓 {len(targets)} 筆，預估 {len(targets) * PAUSE_SECONDS / 60:.0f} 分鐘\n")

    known_ids = db.known_stock_ids()
    ok = failed = 0
    for i, (etf_id, date) in enumerate(targets, 1):
        entry, module = supported[etf_id]
        try:
            holdings = module.fetch_at(entry, date)
            if not holdings:
                raise ValueError("empty holdings")
            prev_date = db.latest_snapshot_date(etf_id, before=date)
            prev_count = db.snapshot_count(etf_id, prev_date) if prev_date else None
            validate(holdings, prev_count, known_ids, entry.universe)
            db.write_snapshot(etf_id, date, holdings)
            if prev_date is not None:
                prev = db.load_snapshot(etf_id, prev_date)
                curr = {h.stock_id: h for h in holdings}
                open_stock_ids = metrics.open_round_stock_ids(
                    db.scoring_events(etf_id, before=date)
                )
                db.write_changes(
                    etf_id,
                    date,
                    diff_snapshots(prev, curr, open_stock_ids=open_stock_ids),
                )
            db.log_scrape(etf_id, date, "ok")
            ok += 1
        except Exception as ex:
            db.log_scrape(etf_id, date, "fail",
                          f"backfill {type(ex).__name__}: {ex}\n{traceback.format_exc()[-500:]}")
            failed += 1
        if i % 50 == 0:
            print(f"  {i}/{len(targets)}  成功 {ok} 失敗 {failed}")
        time.sleep(PAUSE_SECONDS)

    print(f"\n完成：成功 {ok}、失敗 {failed}（失敗明細見 scrape_log）")
    print("下一步（由 User 或授權 session 執行）：")
    print("  uv run python scripts/backfill_aggregates.py")
    print("  uv run python -c \"import datetime as dt; from activeetf import db, metrics; "
          "d=max(db.snapshot_trading_dates(dt.date.today())); "
          "metrics.refresh_open_positions(d); metrics.compute_all(d)\"")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 語法與匯入檢查（不實際執行回補）**

Run: `uv run python -c "import ast,sys; ast.parse(open('scripts/backfill_history.py').read()); print('syntax ok')"`
Expected: `syntax ok`

Run: `uv run pytest`
Expected: 全 PASS（腳本不被測試匯入，但確認未破壞既有模組）

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill_history.py
git commit -m "feat: 歷史 PCF 回補腳本"
```

---

### Task 9: `dashboard_etf_history_range` view

**Files:**
- Create: `scraper/migrations/00N_etf_history_range_view.sql`（N 接續既有最大編號）

- [ ] **Step 1: 寫 migration**

先確認編號：`ls scraper/migrations/` 取最大者 +1。內容：

```sql
-- 各 ETF 的持股歷史起訖。衍生自 holdings_snapshot，不儲存資料——
-- 回補延伸或資料修正後自動反映，不會與事實脫鉤。
create view dashboard_etf_history_range
with (security_invoker = true) as
select etf_id,
       min(trade_date) as history_from,
       max(trade_date) as history_to
from holdings_snapshot
group by etf_id;

grant select on dashboard_etf_history_range to anon, authenticated;
```

- [ ] **Step 2: Commit（套用由 User 執行）**

```bash
git add migrations/
git commit -m "feat: ETF 歷史起訖 view"
```

PR body 需附套用指令供 User 執行：
`psql "$SUPABASE_DB_URL" -f migrations/00N_etf_history_range_view.sql`

---

### Task 10: 前端讀取歷史起訖（TDD）

**Files:**
- Create: `web/lib/history-range.ts`
- Test: `web/lib/history-range.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `web/lib/history-range.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { formatHistoryFrom, type HistoryRange } from "@/lib/history-range";

describe("formatHistoryFrom", () => {
  const ranges: HistoryRange[] = [
    { etfId: "00981A", historyFrom: "2025-05-16", historyTo: "2026-07-24" },
  ];
  it("有資料時回傳起始日說明", () => {
    expect(formatHistoryFrom(ranges, "00981A")).toBe("可用歷史資料自 2025-05-16 起");
  });
  it("查無該 ETF 時回傳 null，由呼叫端決定不顯示", () => {
    expect(formatHistoryFrom(ranges, "00404A")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- lib/history-range.test.ts`
Expected: FAIL — cannot resolve `@/lib/history-range`

- [ ] **Step 3: 實作**

建立 `web/lib/history-range.ts`：

```typescript
import { createReadOnlySupabaseClient } from "@/lib/supabase";

export type HistoryRange = {
  etfId: string;
  historyFrom: string;
  historyTo: string;
};

export function formatHistoryFrom(ranges: HistoryRange[], etfId: string): string | null {
  const found = ranges.find((r) => r.etfId === etfId);
  return found ? `可用歷史資料自 ${found.historyFrom} 起` : null;
}

export async function fetchHistoryRanges(): Promise<{
  ranges: HistoryRange[];
  error: string | null;
}> {
  const supabase = createReadOnlySupabaseClient();
  const { data, error } = await supabase
    .from("dashboard_etf_history_range")
    .select("etf_id, history_from, history_to");
  if (error) {
    return { ranges: [], error: error.message };
  }
  return {
    ranges: (data ?? []).map((r) => ({
      etfId: r.etf_id as string,
      historyFrom: r.history_from as string,
      historyTo: r.history_to as string,
    })),
    error: null,
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- lib/history-range.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add lib/history-range.ts lib/history-range.test.ts
git commit -m "feat: ETF 歷史起訖查詢與格式化"
```

---

### Task 11: 前端揭露不對稱（TDD）

**Files:**
- Modify: `web/app/etf/[etfId]/page.tsx`
- Modify: `web/lib/rankings.ts`（勝率標籤加起算日）
- Modify: `web/components/rankings-table.tsx`
- Test: `web/lib/rankings.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `web/lib/rankings.test.ts` 檔尾新增：

```typescript
import { buildPickingSummaryWithHistory } from "@/lib/rankings";

describe("buildPickingSummaryWithHistory", () => {
  it("勝率標籤後方無條件加註起算日", () => {
    const s = buildPickingSummaryWithHistory(14, 22, "2025-05-16");
    expect(s.label).toContain("自 2025-05-16 起");
  });
  it("無起算日時不加註，其餘行為與既有一致", () => {
    const s = buildPickingSummaryWithHistory(14, 22, null);
    expect(s.label).not.toContain("自");
  });
  it("樣本不足規則不受影響", () => {
    expect(buildPickingSummaryWithHistory(2, 5, "2025-05-16").insufficient).toBe(true);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- lib/rankings.test.ts`
Expected: FAIL — `buildPickingSummaryWithHistory` is not exported

- [ ] **Step 3: 實作**

在 `web/lib/rankings.ts` 檔尾新增（包裝既有 `buildPickingSummary`，不改其行為）：

```typescript
// spec 2026-07-25 §6.2：起算日無條件顯示，不設「差異夠大才標」的門檻——
// 避免「多短才算短」的主觀判斷，讓使用者自行比較樣本期間。
export function buildPickingSummaryWithHistory(
  wins: number,
  total: number,
  historyFrom: string | null,
): ReturnType<typeof buildPickingSummary> {
  const base = buildPickingSummary(wins, total);
  return historyFrom
    ? { ...base, label: `${base.label}｜自 ${historyFrom} 起` }
    : base;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- lib/rankings.test.ts`
Expected: 全 PASS

- [ ] **Step 5: 接進頁面**

`web/app/etf/[etfId]/page.tsx`：在既有 `fetchEtfDetail` 之外並行呼叫 `fetchHistoryRanges()`，於標題區（ETF 名稱下方）加：

```tsx
{formatHistoryFrom(ranges, etfId) && (
  <p className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
    {formatHistoryFrom(ranges, etfId)}
  </p>
)}
```

`web/components/rankings-table.tsx`：選股勝率兩欄（已實現／未平倉）改用 `buildPickingSummaryWithHistory(wins, total, historyFromByEtf[row.etfId] ?? null)`；`historyFromByEtf` 由頁面經 props 傳入（`Object.fromEntries(ranges.map(r => [r.etfId, r.historyFrom]))`）。排行榜頁面 `web/app/rankings/page.tsx` 一併呼叫 `fetchHistoryRanges()` 並傳入。

- [ ] **Step 6: 全套驗證**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run build`
Expected: 全過

- [ ] **Step 7: Commit**

```bash
git add lib/rankings.ts lib/rankings.test.ts components/rankings-table.tsx app/etf/ app/rankings/
git commit -m "feat: 前端揭露各檔歷史資料起始日"
```

---

### Task 12: 端到端驗收（回補執行由 User 進行）

**Files:** 無（驗證步驟）

- [ ] **Step 1: 全套測試**

Run（`scraper/`）: `set -a && source .env.local && set +a && uv run pytest`
Run（`web/`）: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: 全 PASS

- [ ] **Step 2: 交付執行指令（PR body）**

以下由 **User 或授權 session** 依序執行，Generator 不執行：

```bash
# 1. 套用 view migration
psql "$SUPABASE_DB_URL" -f scraper/migrations/00N_etf_history_range_view.sql

# 2. 回補歷史快照（約 2 小時，可中斷續跑）
cd scraper && set -a && source .env.local && set +a
uv run python scripts/backfill_history.py

# 3. 重算衍生表（順序固定）
uv run python scripts/backfill_aggregates.py
uv run python -c "import datetime as dt; from activeetf import db, metrics; \
d=max(db.snapshot_trading_dates(dt.date.today())); \
metrics.refresh_open_positions(d); metrics.compute_all(d)"
```

- [ ] **Step 3: 回補後驗收（User 執行，結果貼回 PR）**

1. `select etf_id, min(trade_date), max(trade_date), count(distinct trade_date) from holdings_snapshot group by etf_id order by 2;` — 12 檔的 `min` 應為各自最早通過驗證日；00990A 2025-12-15 不應有 snapshot，13 檔不支援歷史者仍為 2026-07-13
2. 抽 00981A 任一歷史日，與統一官網該日 PCF 人工對照前五大持股
3. `/etf/00981A` 顯示「可用歷史資料自 YYYY-MM-DD 起」；排行榜勝率欄顯示起算日
4. `select count(*) from holding_change;` — 應遠多於回補前（歷史異動事件已產生）
5. `select etf_id, picking_realized_total from etf_metrics where trade_date=(select max(trade_date) from etf_metrics) order by 2 desc;` — 12 檔的樣本數應明顯高於其餘

- [ ] **Step 4: 開 PR**

依 `docs/superpowers/process/agent-workflow.md`：Generator 開 PR（base `main`），PR body 含變更摘要、驗證輸出、上述執行指令、已知風險。交獨立 Evaluator review。

---

## Self-Review 紀錄

- **Spec 覆蓋**：§3 `fetch_at` 與 `supports_history`=Task 1–5；§4.1 交易日曆與上市日=Task 7（`etf_listing_dates` 取 `stock_price` 最早日）；§4.2 正序/冪等/輪替=Task 6 + Task 8；§4.3 三道驗證=Task 8（呼叫既有 `validate`，未放寬）；§4.4 執行環境=Task 8 腳本 + Task 12 交 User 執行；§5 衍生表重算順序=Task 8 尾與 Task 12 Step 2；§6.1 view=Task 9；§6.2 前端揭露=Task 10–11；§8 測試=各 Task TDD + Task 12。
- **無 placeholder**：唯一動態值為 migration 編號（Task 9 Step 1 指明以 `ls migrations/` 取最大值 +1），屬環境查閱而非未定設計。
- **型別一致**：`supports_history`（Task 1）於 Task 8 使用；`fetch_at(entry, date)` 簽章六家一致（Task 2–5）；`backfill_targets(trading_dates, listing_dates, existing)`（Task 6）於 Task 8 以相同參數名呼叫；`existing_snapshot_keys` / `etf_listing_dates`（Task 7）於 Task 8 使用；`HistoryRange` / `formatHistoryFrom` / `fetchHistoryRanges`（Task 10）於 Task 11 使用；`buildPickingSummaryWithHistory`（Task 11）包裝既有 `buildPickingSummary`。
- **既有函式重用確認**：`db.snapshot_trading_dates`、`db.latest_snapshot_date`、`db.snapshot_count`、`db.load_snapshot`、`db.write_snapshot`、`db.write_changes`、`db.known_stock_ids`、`db.log_scrape`、`validate.validate`、`diff.diff_snapshots` 皆為既有（已於 `db.py`／`validate.py`／`diff.py` 確認），Task 8 直接呼叫未重造。
