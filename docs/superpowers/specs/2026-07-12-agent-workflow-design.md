# ActiveETF agent workflow design

日期：2026-07-12（設計）｜狀態：**已於 2026-07-18 升級為正式版**

> **現行事實來源是 `docs/superpowers/process/agent-workflow.md` 與 `pr-review-checklist.md`。** 本 spec 為設計沿革紀錄：「## 角色分工」與「## Operator 角色說明」仍現行有效（下方已就正式版修訂）；「## 輕量版流程」「## 升級正式版條件」為**歷史章節**（升級條件已達成，見「## 正式版升級」），如與現行 process 文件衝突，以 process 文件為準。

## 目標

建立一套可長期演進的 AI 協作流程，讓 Planner / Generator / Evaluator / Operator 各自承擔清楚角色，降低交接成本與自我審查盲點。角色不綁定特定模型（Claude 或 Codex 皆可擔任），鐵則是實作者 ≠ 審查者。

## 角色分工

| 角色 | 責任 | 主要產出 |
| --- | --- | --- |
| User | Orchestrator / Product Owner，裁決 scope、spec 變更、merge | 優先級、規則裁決、merge 決策 |
| Claude Code | Planner，讀 spec 與現況，產出可交接的任務契約 | generator handoff、acceptance criteria、review focus |
| Generator（Claude 或 Codex） | 實作者，依 handoff 修改 repo、跑驗證、開 PR；不對正式 DB 執行語句 | branch、commit、PR、測試紀錄 |
| Evaluator（Claude 或 Codex，須與 Generator 不同 session） | 評審者，只 review PR/diff，對照 spec 與專案原則找 blocker | findings、測試紀錄、merge recommendation |
| Operator（資料守門人） | merge 後的現實對帳：每日運行健康 + 定期真值比對 | 運行健康摘要、真值對帳報告、缺口/異常回報 |

Planner 預設不直接實作；Generator 不自行宣稱完成而跳過驗證；Evaluator 不修 code，除非 User 明確切換它的角色；Operator 只觀測與回報，不改 code——發現問題轉成 Planner 的新任務。

### Operator 角色說明（2026-07-15 新增）

Planner / Generator / Evaluator 三者都活在「code 世界」——驗證的是「程式是否正確實作」。但 ActiveETF 是資料 pipeline，其產出的**正確性無法靠讀 diff 或跑單元測試驗證**，只能拿產出去對真實世界。這個結構性缺口由 Operator 補上。

實證來源：
- `etf` 母表未播種導致 `holdings_snapshot` 外鍵失敗——Evaluator 讀 diff 沒抓到、單元測試全綠也沒抓到，只有真連線 E2E 才現形（commit 7c5bac2）。
- 驗收清單中「`holding_change` 對照 zdsetf.com / etfinfo.tw」「`etf_metrics` 報酬對照投信官網誤差 < 1pp」屬持續性真值比對，不落在任何 code 角色職責內。

Operator 職責兩塊：

1. **每日運行健康**：確認排程有跑、`scrape_log` 無未補的 `fail`、發現可補的缺口即**回報**——實際補跑（重跑 pipeline 回看 3 天）屬正式 DB 寫入，由 User 或其明確授權 session 執行，Operator 事後對帳。Operator 本身不執行寫入。
2. **定期真值對帳**：抽 3 檔，把異動事件與報酬數字對照 zdsetf.com / etfinfo.tw / 投信官網，抓「程式沒錯但數字錯」這類 code review 看不到的問題。

Operator 是 `CLAUDE.md` 既有規劃的 `data-gap` skill 的角色持有者，不是新發明的職責——skill 化時直接對應。Operator 由誰擔任（Claude Code 另開 session、Codex、或排程任務）不限定，但**只觀測與回報，一律不改 code**：發現問題輸出成可交給 Planner 的任務描述。

## 輕量版流程（歷史，已被 `agent-workflow.md` 的正式版標準流程取代）

> 保留為沿革。現行標準流程與三層驗證見 `docs/superpowers/process/agent-workflow.md`。

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

## 升級正式版條件（歷史，條件已於 2026-07-18 達成）

> 此節記錄當初的升級判準；條件已滿足並完成升級（見「## 正式版升級」）。以下為當時列出的觸發情況：

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
- `data-gap`：資料缺口診斷 runbook（讀 `scrape_log` → 判斷可否補 → 核對照組網站）。Operator 負責診斷與回報；補跑 pipeline 的寫入動作由 User 或授權 session 執行。CLAUDE.md 已規劃。

## 不做事項

- 不導入外部 multi-agent framework。
- 不自動 merge。
- 不讓 Generator 與 Evaluator 共用同一個未隔離 worktree 同時改檔。
- 不把未實戰驗證的流程直接做成 skill。

### 刻意不新增的角色（避免過度複雜、資訊零散）

- **不拆 Evaluator**（security / perf / style 分身）：此規模一個 Evaluator + 一份好 checklist 足夠，拆分只會讓 review 意見散掉。
- **不設獨立 Integration Tester**：整合測試由 Generator **撰寫**（無 `SUPABASE_DB_URL` 自動 skip），對正式 DB 的**執行**由 User 或其明確授權 session 進行、輸出貼進 PR body；Evaluator gate 檢查該證據是否附上（`pr-review-checklist.md`「涉及 DB/外部依賴需附整合或 smoke 證據」）。撰寫與執行分屬不同角色，但都在既有角色職責內，不需獨立 agent。
- **不設 Documentation agent**：文件同步塞進各角色的 acceptance criteria 即可。

角色只在出現「現有角色結構性無法覆蓋」的缺口時才新增（Operator 即為此例）；能靠 checklist 或既有角色職責覆蓋的，一律不新增角色。

## 正式版升級（2026-07-18 裁決）

輕量版實戰 6 個 PR（#3、#5、#8、#9、#10、#11）與兩次資料事故後，User 裁決全部採納升級提案（`docs/superpowers/process/2026-07-17-workflow-upgrade-proposal.md`），流程升為正式版。增補內容已寫入 `docs/superpowers/process/agent-workflow.md` 與 `pr-review-checklist.md`，要點：

- **三層驗證**明文化：Generator 自測 → 獨立 Evaluator → User merge gate。核心是**實作者 ≠ 審查者**；Generator/Evaluator 不再固定綁 Codex，Claude/Codex 可互換，異質性來自 context 隔離。
- **DB 操作權責**：正式 DB 寫入（migration/backfill/資料修復）與 merge 前整合測試的執行，一律由 User（Orchestrator）本人或其明確授權的 agent session 執行；Generator 禁碰 DB；**Operator 角色定義不變，維持唯讀觀測**。
- **資料事故 SOP** 與**測試資料紀律**（`_T` 假代號、雙清理、NaN/null 邊界、單位一致性）。
- handoff 模板新增「設計決策清單」必填欄位。

本節取代前文所有「輕量版／未來再升級」的暫定表述；角色分工表其餘定義不變。
