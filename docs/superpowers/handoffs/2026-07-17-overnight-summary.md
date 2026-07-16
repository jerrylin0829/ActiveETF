# 夜間自主執行摘要 — 2026-07-17 凌晨

執行者：Claude Code（Planner + Generator）｜授權：User（含 migration/backfill）

## 完成事項

1. **main 已同步並推送**（含 Operator 文件 commit、過期資訊修正、雷達 handoff）：
   - `docs: 修正過期資訊`——主 spec 與 CLAUDE.md 檔數不寫死（28 檔會再變）、CLAUDE.md 補前端現況與正式站網址、交集表 spec `25/27` 改 `N/M`
   - `docs(planner): 新倉雷達超額報酬快取 handoff`——`docs/superpowers/handoffs/2026-07-17-radar-excess-return.md`，六個設計決策已寫，**兩項標 ⚖️ 待 User 裁決**（資料起始日前存量持股排除、海外持股列出但報酬「不適用」），核可後才可交 Generator
2. **PR #8（draft）資料層**：`claude/cross-rotation-data`——migration 003（已套用正式 Supabase）、`db.refresh_daily_aggregates`、pipeline 掛載、backfill（已執行，07-13～16）、raw_close 支援、NaN 過濾。71 pytest 全過。
3. **PR #9（draft）前端**：`claude/cross-rotation-web`（stacked on #8）——`/cross` 交集表、`/rotation` 產業輪動、`lib/format.ts` 數字規範。52 vitest + tsc + lint + build 全過；真資料 smoke：486 列、2330 金額對帳完全一致（970.4368 億 @ 07-15）。

## ⚠️ 晨間必辦

1. **Evaluator review 尚未完成**：夜間 API 持續 529 過載，Evaluator subagent 兩次都沒跑起來（若第三次重試成功，報告會補在 PR comment）。請把 PR #8、#9 交給 Codex Evaluator 走 `pr-review-checklist.md`，特別看 PR #8 body 的「事件記錄」段。
2. **07-16 還原價缺口自癒確認**：yfinance 目前對 2026-07-16 整批回 NaN（資料源問題），246 檔當日 `adj_close` 暫為 null。今晚 18:30 pipeline 跑完後檢查：
   `select count(*) from stock_price where trade_date='2026-07-16' and adj_close is not null`
   若 Yahoo 資料未恢復，考慮 FinMind `TaiwanStockPrice` 作 close 備援（需另開 handoff）。
3. **雷達 handoff 兩個 ⚖️ 待裁決項**：核可或修改後才能開工。

## Merge 順序

`PR #8 → main`，然後 `PR #9 改 base 為 main → merge`。#9 合併前 `/cross` 金額欄在 07-16 會顯「—」（缺價日，設計行為）。

## 夜間事件（詳見 PR #8 body）

- 測試種子誤用真實代號 9901/9902（會誤刪正式 stock_info），已改 `_T91`/`_T92` + 雙清理，plan 文件同步修正
- 第一輪 backfill 把 246 檔 07-16 的 adj_close 蓋成 NaN，已止血（NaN→null）+ 修根因（`adj_prices` NaN 過濾 + 測試）；不做「adj=close」推定回填（除權息旺季，錯資料比缺資料危險）
