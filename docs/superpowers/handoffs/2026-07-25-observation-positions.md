# Generator handoff — 觀察部位（0.00% 持股）納入快照

Planner：Claude Code ｜ 日期：2026-07-25 ｜ 目標分支前綴：`codex/`

**優先序：需排在歷史回補之前。** 現行 parser 會丟棄 0% 持股；若先回補 13 個月歷史，等於把缺陷烙進 38 萬列資料，日後修正需全部重跑。

## 背景：實測發現的資料缺口

統一 API 對 00981A 回傳 `AssetCode='ST'` **51 筆**，我方 `uni.parse()` 只存 **37 檔**——權重合計相同（93.72%），差在 14 筆被丟棄：

```
2317 鴻海 1,000 股 0.00%    2382 廣達 1,000 股 0.00%
3008 大立光 1,000 股 0.00%  3661 世芯-KY 1,000 股 0.00%
2481 強茂 5,000 股 0.00%    （另 9 檔同樣型態）
```

成因：`parse()` 過濾條件 `shares > 0 and weight > 0`。這些持股**有真實股數**，只是 1 張部位相對 2,742 億基金的權重被投信自己四捨五入為 0.00。此為經理人常見的「觀察部位」（先放 1 張佔位追蹤）。

**危害**：部位由 1 張放大到實質規模時記為 NEW（正確），但反向——實質部位縮減到只剩 1 張時記為 EXIT（正確）——目前兩者「碰巧正確」是因為 0% 被完全丟棄。一旦納入而不加邊界邏輯，NEW 會退化成 ADD，汙染選股勝率計分起點與新倉雷達回合。

**影響範圍**：15 家 adapter 中 **11 家**有相同的 `weight > 0` 過濾（allianz、fsitc、ab、kgi、ctbc、cathay、mega、fuhua、jpm、uni、yuanta）。

## 設計決策清單

- ✅ **觀察部位算持股**，納入 `holdings_snapshot`（User 2026-07-25 裁決）
- ✅ **定義**：`shares > 0 且 weight_pct = 0`。直接取自上游回報值，不自訂門檻；**不新增 DB 欄位**，此狀態由既有欄位衍生（比照 `dashboard_etf_history_range` 的衍生原則）
- ✅ **事件語意維持現狀**（跨越邊界才算進出）：
  | 轉換 | 事件 |
  |---|---|
  | 無 → 觀察部位 | 無事件（權重變化 0 < 0.05pp，既有門檻自然擋掉） |
| 觀察部位 → 實質部位 | 股數有變且 `abs(Δweight) >= 0.05pp` 時為 **NEW** |
| 實質部位 → 觀察部位 | 股數有變且 `abs(Δweight) >= 0.05pp` 時為 **EXIT** |
  | 觀察部位 → 無 | 原則上無事件；若該股已有未關閉選股計分回合，消失日補記 EXIT |
  | 實質 → 實質 | ADD / TRIM（不變） |
- ✅ **選股計分回合不得因低於門檻的實質→觀察轉換而永久懸空**：diff 必須接收該日期以前依 `build_rounds()` 判定的未關閉股票集合，涵蓋 NEW 與股數增幅 ≥10% 的 ADD。開放回合進入觀察後若消失，於消失日記 EXIT；若回到實質部位，沿用原回合且不得再記 NEW
- ✅ **交集表只計實質部位**（User 裁決 A）：`cross_holdings_daily.etf_count` 排除觀察部位；明細展開時另行顯示「另有 N 檔為觀察部位」
- ✅ **`shares_delta` / `weight_delta_pct` 一律記實際差值**（`h.shares - p.shares`），不因跨越邊界而改記全額——純進出情境下與現行行為完全一致（`p` 不存在時差值即全額）

## Scope

### 1. Adapter 解析（11 家）

移除 `weight > 0` 條件，**保留 `shares > 0`**。11 家一致修改，避免各家行為分歧。若某家的上游對 0 權重持股有不同表示法（例如以空字串或 `null` 回報），於 PR body 說明並個別處理。

### 2. `scraper/src/activeetf/diff.py`（關鍵）

現行以「是否存在於快照」判定 NEW/EXIT（line 13、21），納入觀察部位後**必須加邊界邏輯**，否則語意退化。建議：

```python
def _is_observation(h: Holding) -> bool:
    """觀察部位：有股數但權重為 0，視同尚未建立實質部位。"""
    return h.weight_pct == 0
```

判定改為「把觀察部位視同不存在」，並接收該日期以前依 `build_rounds()` 判定的未關閉選股計分股票集合：`p is None or _is_observation(p)` 且 `not _is_observation(h)` 的候選事件類型為 NEW；`p` 為實質而 `h` 為觀察的候選事件類型為 EXIT；兩端皆為觀察通常無事件。觀察／實質跨界與既有 ADD/TRIM 一樣，皆須 `ds != 0 and abs(dw) >= 0.05` 才實際記事件，避免同股數的上游四捨五入製造假進出。若該股已有未關閉回合，觀察→無必須補 EXIT；觀察→實質則沿用原回合，符合門檻時只記 ADD/TRIM。

### 3. `scraper/src/activeetf/db.py::refresh_daily_aggregates`

`cross_holdings_daily` 的 `etf_count` 與 `total_shares` 排除觀察部位（`h.weight_pct > 0`）。`total_weight_pct` 不受影響（觀察部位貢獻 0）。`industry_weight_daily` 同樣排除，避免產業「持股檔數」被觀察部位灌水。

### 4. 前端顯示

- **ETF 個別頁持股表**：觀察部位列以徽章標示「觀察部位」，權重顯示 `0.00%`，不隱藏
- **交集表明細展開**：實質持有的 ETF 正常列出後，若有觀察部位，另加一行「另有 N 檔 ETF 為觀察部位」
- 觀察部位不參與排序權重（權重為 0 自然排最後）

### 5. 重算既有資料

修改後執行：`scripts/backfill_aggregates.py`（重算 `cross_holdings_daily` / `industry_weight_daily`）。**由 User 或授權 session 執行**，Generator 只提供指令。

## Non-goals

- 不新增 DB 欄位或 migration（觀察部位由既有欄位衍生）
- 不改 0.05pp 事件門檻、不改三道驗證
- 不重抓既有 10 個交易日的快照（見 Risks）
- 不動歷史回補（另一片，本片為其前置）

## Context to Read

- `CLAUDE.md`（三道驗證、錯資料比缺資料危險）
- 主 spec §5（爬蟲層解析與異動判定鐵則）、§7⑤（交集表定義）
- `scraper/src/activeetf/diff.py`（全檔 23 行，NEW/EXIT 判定於 line 13、21）
- `scraper/src/activeetf/adapters/uni.py`（`parse()` line 20-36，過濾條件 line 27）
- `scraper/src/activeetf/validate.py`（筆數檢查只防崩塌，不擋增加——已確認 37→51 不會誤擋）
- `scraper/src/activeetf/db.py::refresh_daily_aggregates`（line 175 起）

## Expected Files

11 個 adapter 模組、`scraper/src/activeetf/diff.py`、`scraper/src/activeetf/db.py`、`web/components/etf-detail/holdings-table.tsx`、`web/components/cross-holdings-table.tsx`，以及對應測試。**spec §5 與 §7⑤ 需同步修訂**（先改 spec 再改 code；本片可於同一 PR 內完成，但 spec 變更須為獨立 commit）。

## Acceptance Criteria

- `uv run pytest`、`npm test`、`tsc --noEmit`、`lint`、`build` 全過
- `diff.py` 測試涵蓋五種轉換（無→觀察、觀察→實質=NEW、實質→觀察=EXIT、觀察→無、實質→實質）；**特別驗證觀察→實質產生 NEW 而非 ADD**，以及同股數或 `abs(Δweight) < 0.05pp` 的跨界不產生事件
- 四日狀態回歸：`NEW 1.00% → TRIM 0.01% → 觀察部位 0% → 消失` 必須在最後一日產生 EXIT，且 `build_rounds()`／`open_position` 不得留下 `exit=None`
- 基線持股回歸：`既有持股 → ADD +20% → TRIM 0.01% → 觀察部位 0% → 消失` 同樣必須產生 EXIT，關閉由 ADD 建立的選股計分回合
- adapter 測試：以含 0 權重列的 fixture 驗證該列被保留且 `weight_pct == 0`
- `refresh_daily_aggregates` 測試：觀察部位不計入 `etf_count`
- 真資料驗收：00981A 抓取後持股數為 51（非 37）、權重合計仍 93.72%、`scrape_log` 為 ok

## Required Verification

- 整合測試以 `_T` 假代號、無 `SUPABASE_DB_URL` 自動 skip（沿用既有慣例）
- 真資料 smoke：對 00981A 執行單檔抓取，比對筆數與權重合計；**確認當次不產生任何 NEW 事件**（14 檔觀察部位首次入庫時權重為 0，不應觸發事件）
- 正式 DB 寫入與 `backfill_aggregates.py` 執行由 User 或授權 session 進行

## Risks

- **首次執行後持股筆數跳增**（37→51）：已確認 `validate.py` 的筆數檢查只防崩塌（`len < prev * ratio`），增加不會誤擋。但 PR body 應記錄各檔實際增減，供 Operator 對帳
- **既有 10 個交易日的快照仍缺觀察部位**：本片不重抓（歷史回補片會以修正後的 parser 抓取更早期間；既有 10 日若要補齊需另行刪除後重抓，屬 Operator 判斷）。事件重算時仍須依日期正序維護所有未關閉選股計分回合，避免低權重回合永久懸空
- **其他 10 家 adapter 的實際影響未知**：本次僅實測統一。Generator 應於 PR body 列出各家修改後的持股筆數變化，若某家暴增（例如翻倍）需檢視是否誤含非持股列（如現金、期貨）
- **交集表涵蓋檔數可能下降**：排除觀察部位後，某些股票的涵蓋檔數會減少——這是修正而非退步，但 PR body 應說明以免被誤判為 bug

## Handoff Prompt

請以 Generator 身分依本 handoff 實作（Generator 須與後續 Evaluator 不同 session）。**`diff.py` 的邊界邏輯是本片核心**——若未加，觀察部位納入後 NEW 會退化為 ADD，汙染選股勝率與雷達。逐項 TDD，spec 修訂為獨立 commit。完成後開 PR（base `main`），PR body 含變更摘要、各 adapter 筆數變化、真資料 smoke 證據、已知風險。不對正式 DB 執行語句。不得在未驗證時宣稱完成。
