# Agent workflow

ActiveETF 使用輕量 agent harness：User 負責調度與裁決，Claude Code 預設當 Planner，Codex 分成 Generator 與 Evaluator 兩個 session。

## 標準流程

1. User 指定目標，並要求 Claude Code 以 Planner 身分產出 handoff。
2. Planner 讀 `CLAUDE.md`、唯一設計 spec、相關 plan/code，填寫 `docs/superpowers/templates/generator-handoff.md`。
3. User 將 handoff 交給 Codex Generator。
4. Generator 建立分支、實作、跑驗證、開 PR。
5. User 將 PR 交給 Codex Evaluator。
6. Evaluator 依 `docs/superpowers/process/pr-review-checklist.md` 與 `docs/superpowers/templates/evaluator-review.md` review。
7. 有 blocker 時，User 將 findings 交回 Generator 修正。
8. Evaluator 二次 review blocker 後，User 決定 merge。

## 角色規則

- Planner 只定義 scope、風險、驗收條件與交接 prompt，除非 User 明確要求，不直接改 code。
- Generator 負責修改 repo，但不得跳過測試或把未驗證事項寫成已完成。
- Evaluator 預設只 review，不直接修 code，避免角色混淆。
- Operator（資料守門人）負責 merge 後的現實對帳——每日運行健康與定期真值比對；只觀測與回報，不改 code，發現問題轉成 Planner 的新任務。角色定義見 spec。
- User 是唯一可裁決 spec 變更、merge、scope tradeoff 的角色。

## 分支與 PR

- Generator 使用 `codex/` 或 User 指定 prefix 建 branch。
- 若基底 PR 尚未合併，新 PR 應以該 feature branch 為 base，避免把上游 diff 混入 review。
- PR body 必須包含：變更摘要、驗證指令、已知風險、是否需要後續工作。

## Spec 規則

- `docs/superpowers/specs/2026-07-04-active-etf-tracker-design.md` 仍是產品與資料規則的唯一事實來源。
- 若實作決策與 spec 衝突，先改 spec，再改 code。
- 流程本身的演進記錄在 `docs/superpowers/specs/2026-07-12-agent-workflow-design.md`。
