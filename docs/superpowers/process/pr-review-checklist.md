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

## Spec 一致性

- diff 中是否有 spec 未記載的規則變更？評審期引入的行為變更（例：`cache_daily_holding_closes` 每日補價、輪動圖顯示範圍與 5/20 日計算窗口解耦）**必須回寫 spec**，不得讓 code 默默偏離文件。發現未回寫即列 blocker。

## 測試資料紀律

- 整合測試種子**只能用 `_T` 開頭的假代號**——真代號（如 `2330`）會撞正式 `stock_info`／`stock_price`，cleanup 可能誤刪正式資料。
- fixture 採 **setup 前 + teardown 後雙清理**，避免中斷的測試殘留污染下一次；平行測試需以 namespace（PID/UUID）隔離。
- 數值邊界**必驗 NaN 與 null**——NaN 不是 null，`coalesce` 擋不住，會滲進 DB 污染衍生表（實例：07-16 yfinance NaN 事件）。
- 單位一致性：以 `_pct` 結尾的欄位存百分比值（如 `12.33`），`etf_metrics` 報酬存比率（如 `0.1233`）；新表命名時二選一，並在 migration 註解標明。

## Operations

- GitHub Actions 排程、timeout、失敗告警是否符合預期（timeout 取消在 Actions 是 `cancelled` 不是 `failure`，告警條件需含 `cancelled()`）。
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
