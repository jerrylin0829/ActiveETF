# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

追蹤台股全部主動式**股票型** ETF（代號結尾 `A`，約 27 檔）的每日持股異動 Dashboard：增減持/新進/出清事件、當前持股比例、績效與勝率指標。公開網站，營運成本 $0/月。

**唯一的設計事實來源**：`docs/superpowers/specs/2026-07-04-active-etf-tracker-design.md`。任何實作決策與該 spec 衝突時，先讀 spec；要改規則就先改 spec（並 commit），不要讓程式碼默默偏離文件。

## 架構（三段式，詳見 spec §3）

```
GitHub Actions（每日 18:30 主場 + 21:30 補抓）
  → Python 爬蟲（15 家投信 adapter，各自實作 fetch(etf_id)）
  → Supabase Postgres（快照 + 事件 + 指標快取）
  → Next.js on Vercel（唯讀呈現，不做計算）
```

- 持股明細（PCF）**只能爬各投信官網**——FinMind、TWSE OpenAPI、SITCA 都沒有這個資料（已查證，見 spec §2），不要再花時間找現成 API
- 還原價用 yfinance（FinMind 免費層無此權限，見 spec §2 2026-07-09 決策）；加權報酬指數（TAIEX_TRI）、stock_info、單檔交易日判斷用 FinMind；TWSE OpenAPI 為備援
- 計算一律在寫入時做（pipeline），前端只 SELECT

## 不可違背的資料原則

1. `holdings_snapshot` 是 append-only 事實來源，所有衍生表（事件、指標）必須可以從它重算
2. 入庫前三道驗證（權重總和 70–101%、筆數無突變、代號存在）任一不過 = 該檔標失敗、**不寫入**——錯資料比缺資料危險
3. 異動事件需「股數變化」與「權重變化 ≥ 0.05pp」**同時成立**（過濾申贖造成的等比例變動與純價格波動）
4. 爬蟲失敗必須可見（`scrape_log` + Dashboard 黃條），不允許靜默缺資料

## 指標規則速記（完整定義在 spec §6，改動須同步 spec）

- 所有報酬用**還原價**；ETF 層級基準 = 0050（還原），個股層級基準 = 加權報酬指數
- 選股勝率計分視窗 = 買進日 → (出清日 or 最新交易日)；未平倉滿 5 個交易日起計浮動分（`MIN_OPEN_SCORING_DAYS = 5`，為待回測的起始值）；已實現/未平倉拆開顯示、永遠帶樣本數
- 持有滿 20 個交易日 = 「長抱」徽章、移出新倉追蹤雷達

## 慣例

- 文件、commit message、UI 文案一律**繁體中文**；程式碼識別字與註解用英文
- Commit 格式：`type: 中文描述`（現有歷史用 `docs:`，之後 `feat:`/`fix:` 依此類推）
- 漲跌標色遵循台股習慣：**紅漲綠跌**

## Agent 協作流程

本專案採輕量 agent harness：User 負責調度與裁決，Claude Code 預設當 Planner，Codex 可分成 Generator / Evaluator 兩個 session。流程與模板見：

- `docs/superpowers/specs/2026-07-12-agent-workflow-design.md`
- `docs/superpowers/process/agent-workflow.md`
- `docs/superpowers/process/pr-review-checklist.md`
- `docs/superpowers/templates/generator-handoff.md`
- `docs/superpowers/templates/evaluator-review.md`

先用文件化輕量版實戰 2–3 個 PR；若協作規則穩定且重複，再升級正式版流程；正式版再穩定後才做專案 skill。

## 目前狀態與指令

資料 pipeline（爬蟲 + Supabase + 每日排程）已完成並上線，見 `docs/superpowers/plans/2026-07-04-data-pipeline.md`（Task 1–16 全數完成）。前端 Dashboard（`web/`，spec §7）尚未開工，屬下一個計畫。

爬蟲指令（在 `scraper/` 下）：
- 測試：`uv run pytest`（需 DB 的整合測試在無 `SUPABASE_DB_URL` 時自動 skip；本機要跑真整合測試先 `set -a && source .env.local && set +a`）
- 每日流程：`uv run python -m activeetf.pipeline`
- 股價回補（一次性）：`uv run python scripts/backfill.py`

裝 Python 套件用 `uv`，不用 pip。`.env.local` 放在 `scraper/` 下（已於 `scraper/.gitignore` 忽略）。

**預定建立的專案 skills**（等對應程式碼存在、流程被實際走過一遍後再建，屆時依 writing-skills 的測試流程）：
- `new-adapter`：新增一家投信 PCF adapter 的完整流程（探測、解析、三道驗證、registry 註冊、測試）
- `data-gap`：資料缺口診斷與補抓 runbook（讀 scrape_log → 判斷可否補 → 重跑 pipeline → 核對照組網站）
