# Agent workflow

ActiveETF 使用輕量 agent harness：User 負責調度與裁決，Claude Code 預設當 Planner，Codex 分成 Generator 與 Evaluator 兩個 session。

## 標準流程

1. User 指定目標，並要求 Claude Code 以 Planner 身分產出 handoff。
2. Planner 讀 `CLAUDE.md`、唯一設計 spec、相關 plan/code，填寫 `docs/superpowers/templates/generator-handoff.md`。handoff 必須含**設計決策清單**，每項標「已裁決」或「待裁決」；標「待裁決」者 User 拍板後才可開工（實例：雷達片六個決策全部標記到位，Generator 一次到位無來回）。
3. User 將 handoff 交給 Generator。
4. Generator 建立分支、實作、跑驗證、開 PR。
5. User 將 PR 交給 **獨立 Evaluator**。
6. Evaluator 依 `docs/superpowers/process/pr-review-checklist.md` 與 `docs/superpowers/templates/evaluator-review.md` review。
7. 有 blocker 時，User 將 findings 交回 Generator 修正。
8. Evaluator 二次 review blocker 後，User 決定 merge。

**三層驗證**（缺一不可）：Generator 自測（TDD）→ 獨立 Evaluator → User merge gate。核心原則是**實作者 ≠ 審查者**：實作與審查角色可互換（Codex 寫 Claude 審，或反過來；亦可 Claude 主 session 實作、subagent 審查），異質性來自 context 隔離而非特定模型。

## 角色規則

- Planner 只定義 scope、風險、驗收條件與交接 prompt，除非 User 明確要求，不直接改 code。
- Generator 負責修改 repo，但不得跳過測試或把未驗證事項寫成已完成。
- Evaluator 預設只 review，不直接修 code，避免角色混淆。
- Operator（資料守門人）負責 merge 後的現實對帳——每日運行健康與定期真值比對；只觀測與回報，不改 code，發現問題轉成 Planner 的新任務。角色定義見 spec。兩次事故（pipeline timeout 被砍、07-16 NaN 污染）都是 merge 後對帳抓到的，此角色不可省。
- User 是唯一可裁決 spec 變更、merge、scope tradeoff 的角色。

## DB 操作權責

- migration 套用、backfill 執行、正式資料修復**一律由 Orchestrator/Operator 執行**；Generator 只寫檔案（migration SQL、腳本），**禁止對任何資料庫執行語句**。
- 理由：正式 DB 是共用單點，寫入權責集中才能追責與止血。雷達片已照此執行（Generator 交出 `004_open_position.sql`，由 Orchestrator 套用與初始化）。

## 資料事故 SOP

發現正式資料被污染或缺損時，依序：

1. **止血**：先清除污染資料（例：NaN → null 全庫更新），阻止它繼續傳播到衍生表。
2. **修根因並以測試鎖住**：找到寫入源頭修掉，補一個會紅的測試防回歸（例：`adj_prices` 過濾 NaN + `test_adj_prices_drops_nan_rows`）。
3. **誠實留缺口**：修不回的資料保持缺（null），**不得用推定值回填**——除權息期間尤其不可用「未還原價 = 還原價」推定。錯資料比缺資料危險。
4. **全文記錄**：事件經過寫進 PR body，供 Evaluator 重點審查。

## 分支與 PR

- Generator 使用 `codex/` 或 User 指定 prefix 建 branch。
- 若基底 PR 尚未合併，新 PR 應以該 feature branch 為 base，避免把上游 diff 混入 review。
- PR body 必須包含：變更摘要、驗證指令、已知風險、是否需要後續工作。

## Spec 規則

- `docs/superpowers/specs/2026-07-04-active-etf-tracker-design.md` 仍是產品與資料規則的唯一事實來源。
- 若實作決策與 spec 衝突，先改 spec，再改 code。
- 流程本身的演進記錄在 `docs/superpowers/specs/2026-07-12-agent-workflow-design.md`。
