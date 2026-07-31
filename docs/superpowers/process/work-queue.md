# 工作佇列與派工流程

最後更新：2026-07-31（Planner: Claude Code）

本文件記錄**當前在飛的工作、依賴順序、以及誰能做什麼**。與 `agent-workflow.md`（角色與三層驗證的通則）互補：那份講「怎麼做」，這份講「現在做到哪、下一步派誰」。

派工或完成一片後請更新本文件。

---

## 依賴圖

```
[已完成] spec 全部落地（PR #21，main bea40e1）
    │
    ├─► G1  radar 建倉脈絡  ────────────────┐  純前端，無依賴
    │        └─► G  當日貢獻度              │  （建議串在 radar 之後）
    │                                       │
    └─► G2  PR #20 的 A（PR body）+ B（adapter 日期驗證，唯讀）
             │
             └─► [User] PR #20 DB gate（序列，只有 User 或授權 session）
                   migration → 真 DB integration → 00990A canary
                   → 完整回補 → backfill_aggregates + metrics 重算
                   → production smoke → merge
                     │
                     ├─► 00408A 覆蓋率缺口（含第四道驗證）
                     └─► /signal 訊號實證
```

**平行性**：G1 與 G2 完全不衝突（一個純前端、一個 scraper 唯讀探測 + 文件）。User 的 DB gate 應等 G2 的 B-1 回報後才開始——先確認六支 adapter 的日期語意，再跑 2,500–3,000 次請求的回補，避免驗出問題要中斷重來。

---

## 佇列

| 片 | handoff | 狀態 | 阻擋於 |
|---|---|---|---|
| radar 建倉脈絡 | `handoffs/2026-07-25-radar-build-narrative.md` | **可派工** | — |
| 當日貢獻度 | `handoffs/2026-07-25-daily-contribution.md` | **可派工** | 建議等 radar |
| PR #20 前置 A+B | `handoffs/2026-07-31-pr20-gate-checklist.md` | **可派工** | — |
| PR #20 DB gate | 同上 §C | 待 B-1 回報 | User 時間 |
| 00408A 覆蓋率 | `handoffs/2026-07-25-etf-00408a-coverage.md` | 已核可 | PR #20 merge |
| `/signal` 訊號實證 | `specs/2026-07-30-signal-analysis-design.md` §0 | 待寫 plan | PR #20 merge + `backfill_aggregates.py` 重跑 |
| 回合成本基礎（含估算均價） | 未寫 | 未開 | 無（隨時可開） |

---

## 已定案、不要重新設計的事

實作者拿到 handoff 時，下列皆已裁決（2026-07-31 User 全數核可十二項），**照做勿重新設計**：

- **雷達**：股票分組／維持 20 交易日／脈絡顯示 TRIM／四象限頁籤／金額用**事件當日**價／不做股票層級彙總報酬
- **貢獻度**：期初 t-1 權重／還原價／僅台股 ETF／當日新進計 0 且不列排行但**列代號**註記／當日 EXIT 計入／估算-實際-**差異**三數字（「差異」不得寫成「未歸因」）
- **前端 vs pipeline**：判準見主 spec §3「呈現層聚合」——結構性質為準，**資料量只是效能逃生門**

---

## 協作約定（多 session 並行時）

1. **主 spec 同時間只由一個 session 編輯。** 曾發生兩個 session 同時要改 §7 的情況；約定由 Planner 統一編輯，其他 session 提供措辭。各自的獨立 design spec 不受此限。
2. **handoff 檔名日期 = 撰寫日**，不是裁決日。裁決日記在檔內「狀態」行。
3. **不要 `mv` 已 commit 的 handoff。** 曾因改名造成 git 看成「刪三個 + 加三個」而丟失 diff 連續性。改日期就改檔內欄位。
4. **正式 DB 寫入與 merge 前整合測試只由 User 或明確授權 session 執行。** Generator 一律只寫 SQL／測試，不執行。

---

## 已知待辦（不擋當前佇列，但別忘了）

- **`cross_holdings_daily` 歷史列仍含觀察部位**。`refresh_daily_aggregates(d)` 是單日重算，PR #19（2026-07-26 合併）之後跑過的日期才正確。目前線上 `/cross` 預設顯示最新日期 → **正確**；但日期選擇器往回切到 07-26 以前 → 檔數偏高。修法就是 `backfill_aggregates.py` 重跑，已排在 PR #20 gate 序列的正確位置（必須在完整回補**之後**，否則回補進來的日期又會缺列）。
- **adapter 丟棄上游回傳的快照日期**。實測第一金 `Get_hd` 每列都帶 `sdate`（權威快照日），但 `parse()` 丟棄、`pipeline.scrape_one` 以執行當日 `today` 寫入。目前每日路徑與回補路徑的偏移恰好一致（皆為 T-1 資料寫在 T）所以運作正常，**但沒有任何程式碼斷言這件事**。建議未來讓 adapter 回傳 `(holdings, source_date)` 並於寫入前核對——屬主 spec §5 層級改動，需先改 spec。
