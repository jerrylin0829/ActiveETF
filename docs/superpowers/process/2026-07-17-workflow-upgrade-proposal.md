# Agent Workflow 升級提案（待 User 裁決）

提案人：Claude Code（Planner）｜日期：2026-07-17
依據：輕量版流程實戰 6 個 PR（#3 排行榜、#5 今日總覽、#8 資料層、#9 前端、#10 hotfix、#11 雷達）與兩次資料事故的經驗。CLAUDE.md 約定「實戰 2–3 個 PR 後評估升級」，現已達標。

## 一、已驗證有效、建議正式化的模式

1. **Handoff 品質決定 Generator 成敗**：schema 寫死、決策標「已裁決」、Non-goals 明確的 handoff（雷達片）一次到位；反之會來回。建議：handoff 模板加「設計決策清單（每項標 已裁決/待裁決）」欄位。
2. **三層驗證**：Generator 自測（TDD）→ 獨立 Evaluator（全新 context，不限定 Codex 或 Claude，重點是**實作者 ≠ 審查者**）→ User merge gate。實作/審查角色可以互換（Codex 寫 Claude 審、或反過來），異質性來自 context 隔離而非特定模型。
3. **Stacked PR**：base 指向未合併的上游分支（#9→#8），review 乾淨、merge 順序被強制。已寫在 workflow 文件，實戰有效，保留。
4. **Operator 對帳角色**：兩次事故（pipeline timeout 被砍、NaN 污染）都是 merge 後對帳抓到的。角色必要，保留並強化（見二-3）。

## 二、新教訓，建議增補進流程文件

1. **DB 操作權責收斂**（增補 `agent-workflow.md`）：migration 套用、backfill 執行、正式資料修復一律由 Orchestrator/Operator 執行；Generator 只寫檔案，禁止對任何資料庫執行語句。本次雷達片已照此執行。
2. **資料事故 SOP**（增補 `agent-workflow.md`）：止血（清除污染資料）→ 修根因（以測試鎖住）→ 誠實留缺口（除權息期間不得用推定值回填還原價）→ 事件全文記錄在 PR body 供 Evaluator 重點審查。07-16 NaN 事件為範例。
3. **Spec 回寫義務**（增補 `pr-review-checklist.md`）：評審期引入的行為變更（如 close 快取、輪動窗口解耦）必須回寫 spec，Evaluator checklist 加一條「diff 中是否有 spec 未記載的規則變更」。
4. **測試資料紀律**（增補 `pr-review-checklist.md`）：
   - 整合測試種子只能用 `_T` 開頭假代號（真代號會撞正式 `stock_info`）
   - fixture 採 setup 前 + teardown 後雙清理
   - 數值邊界必驗 NaN 與 null（NaN 不是 null，coalesce 擋不住）
   - 單位一致性：本專案權重/報酬欄位以 `_pct` 結尾者存百分比值，`etf_metrics` 報酬存比率——新表命名時二選一並在 migration 註解標明

## 三、基礎設施現實（記錄，不進流程文件）

平台級中斷（權限分類器斷線、API 過載）會殺掉長時間執行的 subagent。關鍵長任務可用反轉配置：主 session 實作 + subagent 審查，仍滿足「實作者 ≠ 審查者」。審查類 subagent（一次性讀取）比實作類（長寫入流程）耐中斷。

## 四、暫不建議

- `new-adapter` skill：近期無新投信要接，等實際需求。
- `data-gap` skill：材料已足（07-16 事件是完整案例），建議**下一次**資料缺口處理時邊走邊寫（writing-skills 流程要求實際走過）。

## 裁決請求

同意一、二各項則我把增補寫進 `agent-workflow.md` 與 `pr-review-checklist.md`（一個 docs PR）；有異議的項目單獨說即可。
