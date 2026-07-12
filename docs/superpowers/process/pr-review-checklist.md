# PR review checklist

Evaluator review 先列 blocker，再列 non-blocking issue。沒有 blocker 時要明確說明剩餘風險與未跑驗證。

## ActiveETF invariant

- `holdings_snapshot` 是否維持 append-only 事實來源。
- 所有衍生表是否可由 `holdings_snapshot` 重算。
- 三道驗證是否在寫入前完成：權重總和 70-101%、筆數無突變、台股代號存在。
- 驗證失敗是否整檔不寫入。
- 異動事件是否同時要求股數變化與權重變化 >= 0.05pp。
- 爬蟲失敗是否寫入 `scrape_log`，且不靜默缺資料。

## Metrics

- 報酬與勝率是否使用還原價。
- ETF 層級 benchmark 是否為 0050。
- 個股層級 benchmark 是否為加權報酬指數。
- 已實現 / 未平倉選股勝率是否拆開顯示並帶樣本數。
- 未平倉是否滿 `MIN_OPEN_SCORING_DAYS` 才計分。

## Frontend

- 前端是否只 SELECT，不重算 pipeline 指標。
- 台股漲跌標色是否紅漲綠跌。
- 爬蟲失敗或資料缺口是否可見。

## Operations

- GitHub Actions 排程、timeout、失敗告警是否符合預期。
- 需要 secret 的流程是否有文件與安全邊界。
- 測試是否涵蓋新行為與主要 failure mode。
- 涉及 DB 寫入或外部依賴（Supabase、FinMind、yfinance、投信官網）的變更，是否附整合或 smoke test 證據——只讀 diff 抓不到外鍵、schema、真連線層級的 bug（實例：`etf` 母表未播種導致 `holdings_snapshot` 外鍵失敗，單元測試全綠仍漏，見 commit 7c5bac2）。
- 文件、commit message、UI 文案是否使用繁體中文。

## Review output

每次 review 使用：

- `Blockers`
- `Non-blocking Issues`
- `Tests Run`
- `Merge Recommendation`
