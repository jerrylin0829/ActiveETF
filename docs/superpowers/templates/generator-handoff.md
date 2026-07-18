# Generator handoff

## Goal

<!-- Planner: 用 2-4 句說明這次要完成什麼，以及為什麼現在做。 -->

## 設計決策清單

<!-- 每項設計決策一行，標「✅ 已裁決」或「⚖️ 待裁決」。
     有任何「⚖️ 待裁決」項時，User 拍板前 Generator 不得開工。
     實例見 docs/superpowers/handoffs/2026-07-17-radar-excess-return.md。 -->

## Scope

<!-- 本次必須做的事。 -->

## Non-goals

<!-- 明確不做的事，避免 Generator 擴張 scope。 -->

## Context to Read

- `CLAUDE.md`
- `docs/superpowers/specs/2026-07-04-active-etf-tracker-design.md`

<!-- 補上本任務必讀檔案。 -->

## Expected Files

<!-- 可能會修改或新增的檔案。 -->

## Acceptance Criteria

<!-- 可被 Evaluator 檢查的完成條件。 -->

## Required Verification

<!-- 指定測試、lint、build、manual smoke test。無法跑的驗證要說明原因。 -->

## Risks

<!-- Planner 已知的技術風險、資料風險、spec 衝突點。 -->

## Handoff Prompt

請以 Generator 身分依本 handoff 實作（Generator 可為 Claude 或 Codex，須與後續 Evaluator 不同 session）。完成後開 PR，PR body 請包含變更摘要、驗證指令、已知風險與後續工作。不對正式 DB 執行語句——整合測試撰寫即可，執行由 User 或授權 session 進行。不得在未驗證時宣稱完成。
