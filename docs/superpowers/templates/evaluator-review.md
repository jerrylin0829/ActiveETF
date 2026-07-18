# Evaluator review

## Target

<!-- PR number / branch / commit range。 -->

## Review Focus

- 對照 `CLAUDE.md`
- 對照 `docs/superpowers/specs/2026-07-04-active-etf-tracker-design.md`
- 對照 `docs/superpowers/process/pr-review-checklist.md`

<!-- Planner 或 User 可補充本次特別想看的風險。 -->

## Required Checks

<!-- 指定要跑的測試或命令。 -->

## Output Format

請以 Evaluator 身分 review（Evaluator 可為 Claude 或 Codex，須與 Generator 不同 session）。先列 blocker，依嚴重度排序，並附檔案與行號。若沒有 blocker，明確說明。最後列：

- `Blockers`
- `Non-blocking Issues`
- `Tests Run`
- `Merge Recommendation`

Evaluator 預設不直接修改 code；若發現問題，輸出可交給 Generator 的修正建議。
