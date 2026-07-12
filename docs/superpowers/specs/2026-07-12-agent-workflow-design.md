# ActiveETF agent workflow design

日期：2026-07-12

## 目標

建立一套輕量、可長期演進的 AI 協作流程，讓 Claude Code 與 Codex 在 ActiveETF 專案中各自承擔清楚角色，降低交接成本與自我審查盲點。

本階段只文件化流程與模板，不建立 automation、不新增專案 skill。流程先實戰 2-3 個 PR，穩定後再升級成正式版；若正式版流程仍持續重複，才提煉成 skill。

## 角色分工

| 角色 | 責任 | 主要產出 |
| --- | --- | --- |
| User | Orchestrator / Product Owner，裁決 scope、spec 變更、merge | 優先級、規則裁決、merge 決策 |
| Claude Code | Planner，讀 spec 與現況，產出可交接的任務契約 | generator handoff、acceptance criteria、review focus |
| Codex Generator | 實作者，依 handoff 修改 repo、跑驗證、開 PR | branch、commit、PR、測試紀錄 |
| Codex Evaluator | 評審者，只 review PR/diff，對照 spec 與專案原則找 blocker | findings、測試紀錄、merge recommendation |

Planner 預設不直接實作；Generator 不自行宣稱完成而跳過驗證；Evaluator 不修 code，除非 User 明確切換它的角色。

## 輕量版流程

1. User 指定目標與期望角色。
2. Claude Code 以 Planner 身分讀 `CLAUDE.md`、唯一 spec、相關 plan/code，填寫 `docs/superpowers/templates/generator-handoff.md`。
3. Codex Generator 依 handoff 實作，開獨立分支與 PR，PR body 必須列出變更、驗證、已知風險。
4. Codex Evaluator 依 `docs/superpowers/templates/evaluator-review.md` review PR。
5. 若有 blocker，User 將 review 交回 Generator 修正。
6. Evaluator 二次 review blocker；無 blocker 後，User 決定 merge 或延後。

## ActiveETF review gate

所有 Evaluator review 至少檢查：

- 是否違反 `holdings_snapshot` append-only 事實來源。
- 入庫前三道驗證是否在寫入前完成。
- 異動事件是否同時要求股數變化與權重變化 >= 0.05pp。
- 爬蟲失敗是否寫入 `scrape_log`，且前端階段需可見。
- 報酬與勝率是否使用還原價；ETF benchmark 為 0050，個股 benchmark 為加權報酬指數。
- 前端是否只讀取衍生表，不重新計算 pipeline 指標。
- spec / plan / README / CLAUDE.md 是否與行為同步。

## 升級正式版條件

輕量版跑過至少 2-3 個 PR 後，若出現任一情況，升級為正式版流程：

- Generator 與 Evaluator 對 blocker / non-blocker 分類反覆不一致。
- 同類 review 疑點在兩個以上 PR 重複出現。
- PR 合併前需要固定二審、release gate、或 rollback checklist。
- User 需要同時調度多條功能線，單靠自然語言交接開始混亂。

正式版應補上：

- blocker / non-blocker / follow-up 的明確定義。
- merge policy 與 required checks。
- stacked PR 規則。
- 二次 review 與回歸驗證規則。
- spec 變更 gate：先改 spec，再改 code。

## Skill 化條件

不要在輕量版階段直接建立 skill。等正式版流程再實戰至少 2-3 個 PR，且模板內容穩定後，才考慮建立專案 skill。

適合 skill 化的訊號：

- User 每次都複製相同 prompt 給 Planner / Evaluator。
- review checklist 幾乎不再改動。
- 某個流程有固定輸入、固定輸出、固定驗證方式。

預期候選 skill：

- `planner-handoff`：把需求轉成 Generator 可執行契約。
- `pr-review`：依 ActiveETF gate review PR。
- `fix-review-feedback`：把 Evaluator findings 轉成修正任務。

## 不做事項

- 不導入外部 multi-agent framework。
- 不自動 merge。
- 不讓 Generator 與 Evaluator 共用同一個未隔離 worktree 同時改檔。
- 不把未實戰驗證的流程直接做成 skill。
