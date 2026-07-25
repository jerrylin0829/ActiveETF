# Generator handoff — 異動牆依股票分組與彙總單位修正

Planner：Claude Code ｜ 日期：2026-07-25 ｜ 目標分支前綴：`codex/`

## 設計決策清單（全部已裁決，照做勿重新設計）

- ✅ 異動牆改**依股票分組**：股票為組標題，事件徽章（NEW/EXIT/ADD/TRIM）移到每列 ETF 之前
- ✅ **保留**既有事件類型頁籤（建倉出清／加減碼）與市場切換（台股／海外），分組在篩選結果之內
- ✅ 組標題彙總用**股數**（同一檔股票可加），格式 `N 檔 ETF · 合計 +6,300 張`；**不得**跨 ETF 相加權重百分比
- ✅ **集體動向次要排序鍵與顯示由「合計權重」改為「合計金額」**＝Σ(股數變化 × 當日收盤價)；主 spec §7① 已同步修訂（見 2026-07-25 註記）
- ✅ 排序兩模式可點擊切換：`ETF 檔數`（預設）／`單筆幅度`
- ✅ 「前 5 筆」改以**股票分組**計數，非事件筆數
- ✅ 單位標在數字後方：台股 `+4,800 張`（÷1000）、海外 `+1,120 股`、比例 `+1.25%`、金額 `27.50 億`；缺價 `—`
- ✅ 異動牆與集體動向都要加欄位 header

## Goal

修正兩個問題：(1) 同一檔股票被多檔 ETF 操作時散落各處，看不出集體共識；(2) 跨 ETF 相加權重百分比量綱不成立（各 ETF 規模不同，1% 的基數不一致）——此問題存在於**已上線的集體動向**與原 spec 規則，非僅新功能。

## Scope

依 spec `docs/superpowers/specs/2026-07-25-change-wall-grouping-design.md` 實作：

1. **`web/lib/format.ts`**：新增 `formatLotsWithUnit(shares: number, market: "tw" | "overseas"): string`——台股回 `+4,800 張`（÷1000、千分位、帶正負號），海外回 `+1,120 股`。沿用既有 `stockMarket()` 判別。
2. **`web/lib/today-overview.ts`**：
   - 新增 `groupChangeWall(events, tab, market, sort)`，回傳股票分組結構（型別自訂，需含 `stockId`、`stockName`、`etfCount`、`totalSharesDelta`、`events[]`）。組序依 `sort`（`"etf_count"`／`"single_impact"`，見 spec §4.2），組內依權重變化絕對值降冪。可重用既有 `filterChangeWall`（line 124）先篩選再分組。
   - `CollectiveMove`（line 19）的 `totalWeightDeltaPct` 改為 `totalValueTwd: number | null`；`aggregateMoves`（line 163）與 `sortCollectiveMoves`（line 147）改以金額彙總排序（主鍵仍為 `etfCount`）。缺價的股票 `totalValueTwd` 為 `null`，排序時視為 0。
3. **`web/lib/today-overview-data.ts`**：集體動向的事件需取得對應 `stock_price.close` 以計算金額——查詢選定期間內各 `(stock_id, trade_date)` 的收盤價（比照既有 `fetchStockNames` 的批次查詢模式），缺價則該股金額為 null。
4. **`web/components/change-wall.tsx`**：改為分組渲染 + 排序切換 + 欄位 header + 單位；`visibleLimit`（line 36）語意改為「顯示前 5 個股票分組」，`hiddenCount` 改為剩餘組數。
5. **`web/components/today-overview-dashboard.tsx`**：集體動向加欄位 header（排名／股票／ETF 檔數／合計金額），顯示金額（`formatYi`，缺價 `—`）。

## Non-goals

- 不改 DB schema、pipeline、指標計算（金額在前端由已快取的 `stock_price.close` 算，屬呈現層聚合，比照交集表既有先例）
- 不取消頁籤或市場切換
- 不做異動牆的金額欄（組標題用股數即可）
- 不動雷達區塊

## Context to Read

- `CLAUDE.md`（紅漲綠跌、繁中、前端只 SELECT）
- **設計事實來源**：`docs/superpowers/specs/2026-07-25-change-wall-grouping-design.md`（尤其 §2 彙總單位原則的量綱理由）
- 主 spec §7①（2026-07-25 規則修正註記）
- 既有程式：`web/lib/today-overview.ts`（`filterChangeWall` line 124、`aggregateMoves` line 163、`CollectiveMove` line 19）、`web/components/change-wall.tsx`（line 36 `visibleLimit`、line 83 起主元件）、`web/lib/format.ts`（`stockMarket`、`formatStockLabel`、`formatYi`）
- `web/lib/cross-holdings-data.ts`（批次查價與 null 傳播的既有模式）

## Expected Files

`web/lib/format.ts`、`web/lib/today-overview.ts`、`web/lib/today-overview-data.ts`、`web/components/change-wall.tsx`、`web/components/today-overview-dashboard.tsx`，以及對應 `*.test.ts(x)`。

## Acceptance Criteria

- `npm test`、`npx tsc --noEmit`、`npm run lint`、`npm run build` 全過
- 異動牆：分組正確、徽章在 ETF 前、組標題 `N 檔 ETF · 合計 X 張`、兩種排序切換有效、查看更多以組計數、欄位 header 存在
- 集體動向：欄位 header 存在、顯示合計金額、缺價顯示 `—`、排序主鍵仍為 ETF 檔數
- 單位正確：台股張（÷1000）、海外股、比例 %、金額億
- **全站不再有任何跨 ETF 相加權重百分比之處**

## Required Verification

- 依 spec §7 撰寫純函式與元件測試（含分組排序、單位、金額 null 傳播）
- 真資料 smoke：挑一個有多檔 ETF 操作同一股票的交易日——核對 (a) 分組正確、(b) 組內股數相加＝組標題合計、(c) 集體動向金額與「股數 × 當日收盤價」手算一致（附一筆對帳數字）
- 375px 手機寬度不橫向溢出
- 無 DB 寫入，不需整合測試綠燈證據

## Risks

- **`CollectiveMove` 型別變更**會波及既有 `today-overview.test.ts` 的斷言，需一併更新——這是預期的破壞性變更（原欄位語意本身有誤）。
- **收盤價查詢量**：集體動向期間可長達一個月，`(stock_id, trade_date)` 組合較多；沿用既有分頁查詢模式，勿一次無上限查詢。
- **海外股缺價普遍**（`stock_info` 只有台股，海外多數無 `stock_price`）：金額為 null 屬正常，顯示 `—`，**不得以 0 或其他值推定**。

## Handoff Prompt

請以 Generator 身分依本 handoff 與 spec 實作（Generator 須與後續 Evaluator 不同 session）。逐項 TDD，每個邏輯單位一個 commit（格式 `type: 中文描述`）。完成後開 PR（base `main`），PR body 含變更摘要、驗證指令與輸出、真資料 smoke 證據（含金額手算對帳一筆）、已知風險。不對正式 DB 執行語句；不得在未驗證時宣稱完成。
