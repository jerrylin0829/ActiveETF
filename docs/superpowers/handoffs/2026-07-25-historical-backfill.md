# Generator handoff — 歷史 PCF 回補

Planner：Claude Code ｜ 日期：2026-07-25 ｜ 目標分支：`codex/historical-backfill`

## 設計決策清單（全部已裁決，照做勿重新設計）

- ✅ **12 檔**從各自上市日起逐交易日嘗試回補；僅寫入通過三道驗證的日期，最早可用日不保證等於上市日
- ✅ Adapter 介面用**可選能力** `fetch_at(entry, date)`，**不改** `fetch(entry)`；13 家不支援者不動
- ✅ `etf_metrics` **只重算最新一日**（歷史指標列無人讀取；可逆，日後要做趨勢圖再補）
- ✅ 歷史起始日**不新增 DB 欄位**，以 `dashboard_etf_history_range` view 即時衍生
- ✅ 排行榜勝率**無條件**加註起算日，不設「差異夠大才標」門檻
- ✅ 三道驗證**不放寬**；按時間正序回補（「筆數 vs 前日」需前一日先入庫）
- ✅ 已有快照的 `(etf_id, date)` 跳過 = 冪等 = 續跑機制，不另做進度檔
- ✅ `holding_change` 重建的 fact read 與 destructive replace 必須在同一 transaction，並以固定表鎖順序和每日 pipeline 互斥
- ✅ Dashboard 歷史告警查詢先按 `trade_date`，再按 `run_at, id`；大量回補 log 不得排擠近期告警

## Goal

主 spec §8 原假設「歷史 PCF 無法回補」已被實測推翻——12 檔 ETF 的上游 API 支援指定歷史日期。回補後 `holdings_snapshot` 從 10 個交易日擴充至最長約 13 個月；未通過驗證的歷史日保留可見失敗但不入庫。異動事件、交集表、產業輪動、雷達、選股勝率全部自動獲得歷史深度（append-only 事實來源的設計在此兌現）。

## Scope

**逐 task 依計畫實作**：`docs/superpowers/plans/2026-07-25-historical-backfill.md`（12 個 task，每步含完整程式碼與預期輸出）。

PR 切分建議：Task 1–8（adapter + 腳本）、Task 9–11（view + 前端）可分兩個 PR，或合併為一個；由 Generator 依實作進度判斷。

## Non-goals

- 不改每日 pipeline 的 `fetch(entry)` 流程
- 不為 13 家無日期參數的投信找替代來源
- 不回補歷史 `etf_metrics` 逐日列
- **不執行回補、不套用 migration**——那是 User 或授權 session 的事（見下方）

## Context to Read

- **設計事實來源**：`docs/superpowers/specs/2026-07-25-historical-backfill-design.md`
- **實作步驟**：`docs/superpowers/plans/2026-07-25-historical-backfill.md`
- `CLAUDE.md`（三道驗證、DB 寫入權責、繁中、`uv` 而非 pip）
- `docs/superpowers/process/agent-workflow.md`（角色約束）

## 關鍵實作提醒

1. **中信的 token 要放兩處**：`params={"token": token}` **與** body 都要有，缺 query string 會回空。Planner 首次探測就是漏了這個而誤判中信不支援歷史——計畫 Task 5 有測試專門鎖住此行為，勿移除。
2. **各家日期格式不同**（計畫開頭有對照表，皆為 Planner 實測確認）：統一民國 `115/06/15`、元大 `20260615`、國泰/安聯/中信 ISO、第一金 `2026/06/15`。**勿自行更動格式**。
3. **`fetch()` 改為委派 `_fetch_pcf(entry, None)`**，避免同一家有兩份請求邏輯；既有測試應能原封通過（`fetch()` 行為不變）。
4. **測試一律用 fixture／monkeypatch，不對投信官網發請求**——避免加重上游負擔，且野村目前官網維護中。

## Acceptance Criteria

- `uv run pytest`（含 DB 整合測試）、`npm test`、`npx tsc --noEmit`、`npm run lint`、`npm run build` 全過
- `supports_history()` 正確辨識 6 家有／9 家無
- 六家 `fetch_at` 的日期格式測試皆通過（含中信 token 雙置）
- `backfill_targets` 測試涵蓋：上市日過濾、跳過既有、時間正序、跨 ETF 輪替
- 00990A 2025-12-15 的 50.80% 股票曝險維持 validation failure、不寫 snapshot；後續最早合格日成為 `history_from`
- 最終統計分列已有快照跳過、validation failure 與 fetch failure
- event rebuild unit test 驗證 lock/read/delete/insert 順序，真 Supabase `_T` integration 驗證成功 replace 與 constraint failure rollback
- 超過 250 筆舊交易日回補 log 時，近期每日 failure 仍出現在 Dashboard 黃條
- 回補腳本可通過語法與匯入檢查（不實際執行）

## Required Verification

- 單元測試以 fixture 覆蓋；DB 整合測試用 `_T` 假代號、無 `SUPABASE_DB_URL` 自動 skip
- **回補執行與 migration 套用不在本 PR**：PR body 需附計畫 Task 12 Step 2 的完整執行指令供 User 執行

## Risks

- **既有 adapter 測試可能因重構失敗**：`fetch()` 改委派後行為應完全一致，若既有測試紅了代表重構有誤，不要改測試遷就實作
- **驗證失敗率未知**：歷史資料格式或資產配置可能導致三道驗證不過。00990A 2025-12-15 已知僅 50.80%，必須略過而非放寬 invariant；PR body 應提醒 User 分別檢視 validation/fetch failure
- **野村 3 檔不在本次範圍**：官網維護中無法探測，維護結束後若確認支援，只需加一個 `fetch_at` 即自動納入回補（腳本以 `supports_history()` 動態偵測，無需改腳本）

## Handoff Prompt

請以 Generator 身分依 `docs/superpowers/plans/2026-07-25-historical-backfill.md` 逐 task 實作（Generator 須與後續 Evaluator 不同 session）。分支 `codex/historical-backfill`。逐項 TDD，每個邏輯單位一個 commit（格式 `type: 中文描述`）。完成後開 PR（base `main`），PR body 含變更摘要、驗證輸出、**回補與 migration 的執行指令**、已知風險。**不對正式 DB 執行語句、不執行回補腳本、不對投信官網發測試請求**。不得在未驗證時宣稱完成。
