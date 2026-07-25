# Generator handoff — 爬蟲韌性：pipeline 重試、上游阻擋可辨識、缺口補抓策略

Planner：Claude Code ｜ 日期：2026-07-25 ｜ 目標分支前綴：`codex/`

## 背景：2026-07-24 00985A 失敗的診斷

`scrape_log` 實證：

| 時間（UTC） | ETF | 結果 |
|---|---|---|
| 07-24 12:01:22 | 00980A（野村） | ok |
| 07-24 12:03:01 | 00985A（野村） | fail — `ReadTimeout`（30s） |
| 07-24 12:06:48 | 00999A（野村） | ok |
| 07-24 15:13:06 | 00985A 補抓 | fail — `JSONDecodeError: Expecting value: line 1 column 1` |

2026-07-25 由 Planner 從本機實測 `POST /API/ETFAPI/api/Fund/GetFundTradeInfoDate`：**00985A 與 00980A 皆回 HTTP 200 但 body 是 17KB 的 PNG 圖片**，`Server: BigIP`（F5 WAF），content-type 為空。即 `JSONDecodeError` 的真正成因是**上游 WAF 回傳非 JSON 內容**，非解析邏輯錯誤。00985A 單獨失敗只是時序運氣——當下輪到它撞上。

三個結構性問題因此曝光：

1. `pipeline.py` **沒有任何重試**，`adapters/base.py` 卻明文寫「重試、驗證、入庫都在 pipeline，adapter 保持純粹」——文件承諾未實作。單次網路打嗝即整檔當日失敗；野村每檔要打兩次 API，機率加倍。
2. WAF 阻擋回傳非 JSON 時，錯誤訊息是難懂的 `JSONDecodeError`，看不出是上游阻擋。
3. 主 spec §9 寫「Actions 整日未跑 → 隔日回看 3 天自動補」，但 `pipeline.main()` 只跑 `today`，`scrape_one` 只檢查當天——**跨日補抓未實作**。

## 設計決策清單

- ✅ **重試放在 `pipeline.scrape_one`**，不放 adapter——符合 `base.py` 既有架構聲明，且 15 家 adapter 一次受惠
- ✅ 重試 3 次、指數退避（2s／5s／10s）；**只對暫時性錯誤重試**（連線/逾時類、上游阻擋類），`ValidationError` 與解析結構錯誤**不重試**（資料問題重試無用，且違反「錯資料比缺資料危險」的快速失敗精神）
- ✅ 新增可辨識的例外型別，讓 `scrape_log` 直接看得出「被上游阻擋」而非埋在 traceback
- ⚖️ **待 User 裁決**：跨日缺口補抓的方向（見下方 Scope 3），實作前必須先取得裁決

## Scope

### 1. Pipeline 重試（`scraper/src/activeetf/pipeline.py`）

在 `scrape_one` 對 `deps.fetch(entry)` 加重試迴圈：

- 最多 3 次嘗試，失敗間隔 2s → 5s → 放棄
- 可重試的例外：`requests.Timeout`、`requests.ConnectionError`、新增的 `UpstreamBlockedError`（見 Scope 2）
- 不可重試：`ValidationError`、`KeyError`／`IndexError`（解析結構變了，重試無意義）
- 最終失敗才寫 `scrape_log`，錯誤訊息需含「已重試 N 次」
- 重試不得繞過既有的 `scraped_ok` 冪等檢查

### 2. 上游阻擋可辨識（`scraper/src/activeetf/adapters/base.py` + `nomura.py`）

- 於 `base.py` 新增 `UpstreamBlockedError(RuntimeError)` 與共用 helper，例如 `ensure_json(response) -> dict`：當 `content-type` 非 JSON、或 body 前綴為已知二進位魔術數字（PNG `\x89PNG`、JPEG `\xff\xd8`、PDF `%PDF`）、或 `response.json()` 拋錯時，改拋 `UpstreamBlockedError`，訊息含 HTTP 狀態、content-type、body 長度與前 40 bytes 的 repr
- `nomura.py` 的 `_post()` 改用 `ensure_json()`
- 其他 adapter 若有相同「預期 JSON」的呼叫可一併改用（不強制，避免 scope 擴散）

### 3. ⚖️ 跨日缺口補抓 — 待裁決後才實作

**事實限制**（Planner 已查證）：
- adapter 介面為 `fetch(entry)`，**無 date 參數**；改為 `fetch(entry, date)` 需動全部 15 家 adapter
- `nomura.fetch()` 永遠取 API 回的 `LatestDate`；`_request_body` 雖有 `date` 參數但未被用於歷史查詢，且**目前 WAF 阻擋，無法驗證 API 是否真能取歷史日**
- 多數投信官網只揭露最新一日 PCF，跨日補抓在多數家很可能根本不可行

**兩個方向，請 User 擇一**：

- **方向 A（Planner 建議）修 spec 承認現實**：主 spec §9 改為「PCF 跨交易日即永久缺口，不做跨日補抓；當日 18:30／21:30 兩場 + 本次新增的 pipeline 重試為唯一復原機制；缺口由 Dashboard 黃條如實揭露」。成本低、誠實、符合 YAGNI 與既有資料原則。
- **方向 B 做選擇性回補**：先探測（WAF 恢復後）野村 API 是否支援指定歷史日期；若可行，為「支援歷史查詢」的 adapter 引入可選能力（例如 `fetch_at(entry, date)`），pipeline 僅對這些 adapter 回看 3 天。工程量大且僅部分投信可用。

裁決前，本 PR **只做 Scope 1、2**；Scope 3 待裁決後另開 PR 或補進本 PR。

## Non-goals

- 不繞過、不規避上游的機器人偵測機制（不做 UA 偽裝輪替、代理 IP 規避、驗證挑戰處理）。若確認野村為刻意阻擋自動化存取，正途是由 User 洽野村投信取得合規資料管道——PCF 為法定每日揭露資訊
- 不收斂 `tsit.py` 既有的 adapter 層重試（與新 pipeline 重試並存暫時可接受，避免 scope 擴散；可列 follow-up）
- 不改 DB schema、不改前端

## Context to Read

- `scraper/src/activeetf/adapters/base.py`（架構聲明：重試屬 pipeline）
- `scraper/src/activeetf/pipeline.py`（`scrape_one` line 24 起、`main` line 58 起）
- `scraper/src/activeetf/adapters/nomura.py`（`_post` line 33、`fetch` line 44）
- `scraper/src/activeetf/adapters/tsit.py`（既有 adapter 層重試寫法，作為參考）
- 主 spec §9 錯誤處理總表
- `CLAUDE.md`（禮貌原則：每日約 27 次請求、間隔 1–2 秒）

## Expected Files

- `scraper/src/activeetf/adapters/base.py`（`UpstreamBlockedError`、`ensure_json`）
- `scraper/src/activeetf/adapters/nomura.py`（`_post` 改用 `ensure_json`）
- `scraper/src/activeetf/pipeline.py`（`scrape_one` 重試）
- `scraper/tests/test_pipeline.py`（重試行為）、`scraper/tests/test_adapter_nomura.py`（阻擋辨識）、必要時新增 `scraper/tests/test_adapter_base.py`

## Acceptance Criteria

- `uv run pytest` 全綠
- 重試測試涵蓋：暫時性錯誤重試後成功、連續 3 次失敗才記 log 且訊息含重試次數、`ValidationError` 不重試（以 FakeDeps 注入驗證呼叫次數）
- 阻擋辨識測試涵蓋：回傳 PNG bytes → 拋 `UpstreamBlockedError` 且訊息含 content-type 與 body 前綴；正常 JSON → 正常回傳
- 重試不影響既有冪等性（同日已 ok 者不重跑）
- 每日請求量仍符合禮貌原則（重試僅在失敗時發生，最壞情況每檔 3 次）

## Required Verification

- 單元測試以 mock/fake 覆蓋，**不對野村官網發測試請求**（WAF 阻擋中，且避免加重上游負擔）
- 無 DB 寫入變更，不需整合測試證據
- PR body 需說明：重試策略選擇的理由、哪些例外不重試及為何

## Risks

- **重試延長單次 pipeline 執行時間**：最壞情況（全部失敗）約增加 27 檔 × 7 秒 ≈ 3 分鐘。GitHub Actions timeout 目前 45 分鐘（PR #10 已調整），仍有餘裕，但 PR body 需評估實際影響
- **`UpstreamBlockedError` 分類過寬**可能把真正的解析錯誤誤判為可重試——僅以 content-type 與二進位魔術數字判斷，勿以「json() 拋錯」單一條件涵蓋所有情況
- **07-24 00985A 的缺口不會被本 PR 修復**（跨日補抓屬 Scope 3）。已知下游影響：07-25 該檔的 diff 基準會是 07-23，07-24 發生的異動將被歸到 07-25 的事件日期——此為缺資料下的合理行為，記錄備查，不在本 PR 處理

## Handoff Prompt

請以 Generator 身分依本 handoff 實作 **Scope 1 與 2**（Scope 3 待 User 裁決，勿自行選定方向）。Generator 須與後續 Evaluator 為不同 session。逐項 TDD，每個邏輯單位一個 commit（格式 `type: 中文描述`）。完成後開 PR（base `main`），PR body 含變更摘要、驗證輸出、重試策略理由、已知風險。不對正式 DB 執行語句；不對野村官網發測試請求；不得在未驗證時宣稱完成。
