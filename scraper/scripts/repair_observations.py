"""補回既有快照缺少的觀察部位（spec §9.1）。

PR #19 之前，部分 adapter 會丟棄 `weight_pct = 0` 的持股，導致該段期間的既有
每日快照缺觀察部位。缺列會讓 diff 把「實質↔觀察」誤判成完整進出（`diff.py`
的 NEW／EXIT 對缺列無門檻），產生假事件。

**Bounded append-only**：只 INSERT「DB 缺少且上游權重為 0」的列，不 update、
不 delete；既有列必須與上游逐檔完全一致才動該日，且上游資料日必須等於該
`trade_date`。任一條件不符即整日跳過並報告，不寫入。

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
    parser.add_argument("--from", dest="start", type=dt.date.fromisoformat)
    parser.add_argument("--to", dest="end", type=dt.date.fromisoformat)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    supported, _ = discover_adapters(entries())
    existing_keys = sorted(db.existing_snapshot_keys(sorted(supported)))
    targets = [
        (etf_id, trade_date)
        for etf_id, trade_date in existing_keys
        if (args.start is None or trade_date >= args.start)
        and (args.end is None or trade_date <= args.end)
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
    for index, (etf_id, trade_date) in enumerate(targets, 1):
        entry, module = supported[etf_id]
        offset = adapter_base.history_request_offset(module, etf_id)
        request_date = request_date_for(calendar, trade_date, offset)
        if request_date is None:
            print(f"  {etf_id} {trade_date}：交易日曆換算不出請求日，跳過")
            skipped += 1
            continue
        expected_source = request_date_for(
            calendar, trade_date, adapter_base.history_source_offset(module, etf_id)
        )
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

        if index < len(targets):
            time.sleep(PAUSE_SECONDS)

    print(
        f"\n完成：需修復 {repaired} 個交易日（共 {inserted_rows} 列）、"
        f"已完整 {complete} 個、跳過 {skipped} 個"
    )
    if not args.apply and repaired:
        print("以上為 DRY-RUN。確認無誤後加 --apply 實際寫入。")
    if skipped:
        print("有跳過的日期：請先查明原因，不可略過不看。")


if __name__ == "__main__":
    main()
