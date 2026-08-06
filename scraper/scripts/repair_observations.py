"""補回既有快照缺少的觀察部位（spec §9.1）。

PR #19 之前，部分 adapter 會丟棄 `weight_pct = 0` 的持股，導致該段期間的既有
每日快照缺觀察部位。缺列會讓 diff 把「實質↔觀察」誤判成完整進出（`diff.py`
的 NEW／EXIT 對缺列無門檻），產生假事件。

**Bounded append-only**：
- 範圍必須由呼叫端**明確指定**（`--etf-id` 可重複、`--from`、`--to` 皆為必填）；
  不接受「掃全部」，否則完整回補後等於再對上游發數千次請求。
- 只 INSERT「DB 缺少且上游權重為 0」的列，不 update、不 delete。
- 既有列必須與上游逐檔完全一致，且上游資料日等於**逐檔算出的期望資料日**才動該日。
- 任一條件不符即整日跳過、不寫入，且**整輪以非零 exit code 結束**——帶著未修復的
  缺口去重建事件，等於把假事件固化下來。
- 每一次對上游的請求後都會間隔 `PAUSE_SECONDS`，失敗（含 503）也不例外。

預設為 dry-run；`--apply` 才寫入，且僅由 User 或明確授權 session 執行。
"""

import argparse
import datetime as dt
import time
from collections.abc import Sequence

from activeetf import db
from activeetf.adapters import base as adapter_base
from activeetf.backfill import discover_adapters, plan_repair, request_date_for
from activeetf.registry import entries
from activeetf.validate import SourceDateMismatch, validate_source_date

PAUSE_SECONDS = 2.0
# 位移換算需要目標範圍外的相鄰交易日，日曆往兩邊各多要一段
CALENDAR_MARGIN = dt.timedelta(days=14)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="補回既有快照缺少的觀察部位")
    parser.add_argument("--apply", action="store_true", help="實際寫入（預設只報告）")
    parser.add_argument(
        "--etf-id",
        action="append",
        required=True,
        dest="etf_ids",
        help="要修復的 ETF（可重複指定）；必填，不接受掃全部",
    )
    parser.add_argument(
        "--from", dest="start", type=dt.date.fromisoformat, required=True
    )
    parser.add_argument(
        "--to", dest="end", type=dt.date.fromisoformat, required=True
    )
    args = parser.parse_args(argv)
    if args.start > args.end:
        parser.error("--from 不可晚於 --to")
    return args


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    supported, _ = discover_adapters(entries())
    unknown = [etf_id for etf_id in args.etf_ids if etf_id not in supported]
    if unknown:
        raise SystemExit(f"這些 ETF 不支援歷史查詢或不存在：{unknown}")

    existing_keys = sorted(db.existing_snapshot_keys(sorted(args.etf_ids)))
    targets = [
        (etf_id, trade_date)
        for etf_id, trade_date in existing_keys
        if args.start <= trade_date <= args.end
    ]
    if not targets:
        print("沒有符合範圍的既有快照。")
        return

    calendar = db.benchmark_trading_dates(
        min(date for _, date in targets) - CALENDAR_MARGIN,
        max(date for _, date in targets) + CALENDAR_MARGIN,
    )
    mode = "APPLY（會寫入）" if args.apply else "DRY-RUN（不寫入）"
    print(f"{mode}：{len(targets)} 個 (ETF, 交易日) 待檢查\n")

    repaired = complete = skipped = 0
    inserted_rows = 0
    for etf_id, trade_date in targets:
        entry, module = supported[etf_id]
        request_date = request_date_for(
            calendar, trade_date, adapter_base.history_request_offset(module, etf_id)
        )
        expected_source = request_date_for(
            calendar, trade_date, adapter_base.history_source_offset(module, etf_id)
        )
        if request_date is None:
            print(f"  {etf_id} {trade_date}：交易日曆換算不出請求日，跳過")
            skipped += 1
            continue

        try:
            holdings, upstream_date = module.fetch_at(entry, request_date)
            validate_source_date(upstream_date, expected_source)
        except SourceDateMismatch as ex:
            print(f"  {etf_id} {trade_date}：{ex}，跳過")
            skipped += 1
            continue
        except Exception as ex:
            print(f"  {etf_id} {trade_date}：{type(ex).__name__}: {ex}，跳過")
            skipped += 1
            continue
        finally:
            # 失敗（含 503）同樣要間隔，否則會連續打上游
            time.sleep(PAUSE_SECONDS)

        plan = plan_repair(
            db.load_snapshot(etf_id, trade_date),
            {h.stock_id: h for h in holdings},
        )
        if not plan.safe:
            print(
                f"  {etf_id} {trade_date}：既有列與上游不符 {plan.conflicts[:5]}"
                f"／缺少實質部位 {plan.unexpected_missing[:5]}，跳過（不寫入）"
            )
            skipped += 1
        elif not plan.missing_observations:
            complete += 1
        else:
            count = len(plan.missing_observations)
            ids = sorted(h.stock_id for h in plan.missing_observations)
            print(f"  {etf_id} {trade_date}：補 {count} 檔觀察部位 {ids[:8]}")
            if args.apply:
                db.write_snapshot(etf_id, trade_date, plan.missing_observations)
            repaired += 1
            inserted_rows += count

    print(
        f"\n完成：需修復 {repaired} 個 ETF-交易日（共 {inserted_rows} 列）、"
        f"已完整 {complete} 個、跳過 {skipped} 個"
    )
    if not args.apply and repaired:
        print("以上為 DRY-RUN。確認無誤後加 --apply 實際寫入。")
    if skipped:
        raise SystemExit(
            f"有 {skipped} 個 ETF-交易日被跳過，未修復。"
            "\n請先查明原因——帶著未修復的缺口重建事件會把假事件固化下來。"
        )


if __name__ == "__main__":
    main()
