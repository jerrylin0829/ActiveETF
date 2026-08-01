"""One-off 歷史 PCF 回補（spec 2026-07-25）。

只處理實作 fetch_at 的 adapter；已有快照直接跳過，三道驗證不放寬。
回補與正式 migration 僅由 User 或明確授權 session 執行。
"""

import datetime as dt
import argparse
import time
import traceback
from collections.abc import Sequence
from zoneinfo import ZoneInfo

from activeetf import db, metrics
from activeetf.adapters import base as adapter_base
from activeetf.backfill import (
    backfill_targets,
    discover_adapters,
    request_date_for,
)
from activeetf.diff import diff_snapshots
from activeetf.models import Change, Holding
from activeetf.registry import entries
from activeetf.validate import (
    SourceDateMismatch,
    ValidationError,
    validate,
    validate_source_date,
)

PAUSE_SECONDS = 2.0
# 位移換算需要目標日前後的交易日，故查日曆時往兩邊各多要一段
CANARY_WINDOW = dt.timedelta(days=14)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="回補歷史 PCF 持股")
    parser.add_argument(
        "--etf-id",
        help="只處理一檔 ETF；必須搭配 --date，形成單日 canary",
    )
    parser.add_argument(
        "--date",
        type=dt.date.fromisoformat,
        help="只處理指定交易日（YYYY-MM-DD）；必須搭配 --etf-id",
    )
    parser.add_argument(
        "--rebuild-changes",
        action="store_true",
        help="只重建 holding_change，不抓任何資料；須先確認回補的失敗分布",
    )
    args = parser.parse_args(argv)
    if (args.etf_id is None) != (args.date is None):
        parser.error("--etf-id 與 --date 必須一起提供")
    if args.rebuild_changes and args.etf_id is not None:
        parser.error("--rebuild-changes 不可與 --etf-id／--date 併用")
    return args


def _today() -> dt.date:
    return dt.datetime.now(ZoneInfo("Asia/Taipei")).date()


def build_holding_changes(
    snapshots: dict[dt.date, dict[str, Holding]],
) -> list[tuple[dt.date, Change]]:
    """Replay complete snapshots into deterministic derived events."""
    dates = sorted(snapshots)
    dated_changes = []
    scoring_events = []

    for previous_date, current_date in zip(dates, dates[1:], strict=False):
        previous = snapshots[previous_date]
        current = snapshots[current_date]
        open_stock_ids = metrics.open_round_stock_ids(scoring_events)
        changes = diff_snapshots(
            previous,
            current,
            open_stock_ids=open_stock_ids,
        )
        for change in changes:
            prior = previous.get(change.stock_id)
            scoring_events.append(
                (
                    current_date,
                    change.stock_id,
                    change.change_type,
                    change.shares_delta,
                    prior.shares if prior else 0,
                )
            )
            dated_changes.append((current_date, change))
    return dated_changes


def rebuild_holding_changes(etf_ids: list[str]) -> None:
    """Replay histories while the DB holds the rebuild transaction boundary."""
    for etf_id in etf_ids:
        change_count = db.rebuild_changes_from_snapshot_history(
            etf_id,
            build_holding_changes,
        )
        print(f"  {etf_id}：重建 {change_count} 筆異動")


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    canary = args.etf_id is not None
    supported, skipped = discover_adapters(entries())
    if canary:
        if args.etf_id not in supported:
            raise SystemExit(f"ETF 不支援歷史回補或不存在：{args.etf_id}")
        supported = {args.etf_id: supported[args.etf_id]}
        print(f"Canary：{args.etf_id} {args.date.isoformat()}")
    print(f"支援歷史回補：{len(supported)} 檔 → {sorted(supported)}")
    print(f"不支援（上游無日期參數）：{len(skipped)} 檔 → {skipped}\n")
    if not supported:
        return

    supported_ids = sorted(supported)
    listing_dates = db.etf_listing_dates(supported_ids)
    missing_listing = [
        etf_id for etf_id in supported_ids if etf_id not in listing_dates
    ]
    if missing_listing:
        print(f"無價格資料、無法推得上市日，略過：{missing_listing}")
    if not listing_dates:
        return

    eligible_ids = sorted(listing_dates)
    if args.rebuild_changes:
        print("重建 holding_change（不抓取任何資料）：")
        rebuild_holding_changes(eligible_ids)
        return

    if canary:
        trading_dates = db.benchmark_trading_dates(
            args.date - CANARY_WINDOW,
            args.date + CANARY_WINDOW,
        )
        if args.date not in trading_dates:
            raise SystemExit(f"指定日期不是 0050 有效交易日：{args.date}")
    else:
        # 兩端各留一段：位移換算需要目標範圍外的相鄰交易日
        trading_dates = db.benchmark_trading_dates(
            min(listing_dates.values()) - CANARY_WINDOW,
            _today() + CANARY_WINDOW,
        )
    # 日曆要完整（位移換算需要目標日的前後交易日），但目標只到今天為止
    target_dates = (
        [args.date] if canary else [d for d in trading_dates if d <= _today()]
    )
    existing = db.existing_snapshot_keys(eligible_ids)
    all_targets = backfill_targets(
        target_dates,
        listing_dates,
        set(),
    )
    targets = backfill_targets(target_dates, listing_dates, existing)
    skipped_existing = len(all_targets) - len(targets)
    estimated_minutes = len(targets) * PAUSE_SECONDS / 60
    print(
        f"待抓 {len(targets)} 筆、已有快照跳過 {skipped_existing} 筆，"
        f"預估 {estimated_minutes:.0f} 分鐘\n"
    )

    known_ids = db.known_stock_ids() if targets else set()
    ok = validation_failed = fetch_failed = source_date_failed = 0
    for index, (etf_id, trade_date) in enumerate(targets, 1):
        entry, module = supported[etf_id]
        try:
            request_date = request_date_for(
                trading_dates,
                trade_date,
                adapter_base.history_request_offset(module, etf_id),
            )
            if request_date is None:
                raise LookupError(
                    f"交易日曆內找不到 {trade_date} 對應的請求日"
                    f"（位移 {adapter_base.history_request_offset(module, etf_id)} 個交易日）"
                )
            expected_source = request_date_for(
                trading_dates,
                trade_date,
                adapter_base.history_source_offset(module, etf_id),
            )
            holdings, upstream_date = module.fetch_at(entry, request_date)
            validate_source_date(upstream_date, expected_source)
            previous_date = db.latest_snapshot_date(etf_id, before=trade_date)
            previous_count = (
                db.snapshot_count(etf_id, previous_date)
                if previous_date
                else None
            )
            validate(
                holdings,
                previous_count,
                known_ids,
                entry.universe,
            )
            db.write_snapshot(etf_id, trade_date, holdings)
            db.log_scrape(etf_id, trade_date, "ok")
            ok += 1
        except ValidationError as ex:
            detail = (
                f"backfill {type(ex).__name__}: {ex}\n"
                f"{traceback.format_exc()[-500:]}"
            )
            db.log_scrape(etf_id, trade_date, "fail", detail)
            validation_failed += 1
            if isinstance(ex, SourceDateMismatch):
                source_date_failed += 1
        except Exception as ex:
            detail = (
                f"backfill {type(ex).__name__}: {ex}\n"
                f"{traceback.format_exc()[-500:]}"
            )
            db.log_scrape(etf_id, trade_date, "fail", detail)
            fetch_failed += 1

        if index % 50 == 0:
            print(
                f"  {index}/{len(targets)}  成功 {ok} "
                f"驗證失敗 {validation_failed} 抓取失敗 {fetch_failed}"
            )
        if index < len(targets):
            time.sleep(PAUSE_SECONDS)

    if canary:
        print("Canary 完成：未重建 holding_change；可確認 fetch、validation、snapshot/log 行為。")
    print(
        f"\n完成：成功 {ok}、已有快照跳過 {skipped_existing}、"
        f"驗證失敗 {validation_failed}、抓取失敗 {fetch_failed}"
        "（失敗明細見 scrape_log）"
    )
    if source_date_failed:
        # 事件由快照歷史重建，日期錯位會讓整段歷史失真——先查明再決定，不自動往下走
        raise SystemExit(
            f"其中 {source_date_failed} 筆為上游資料日不符（SourceDateMismatch）。"
            "\n已中止：未重建 holding_change。請先查明失敗分布"
            "（集中在某段期間或某一家？），確認後再執行："
            "\n  uv run python scripts/backfill_history.py --rebuild-changes"
        )
    if not canary:
        print(
            "\n快照回補完成，**尚未**重建 holding_change。"
            "確認上方失敗分布後再執行："
            "\n  uv run python scripts/backfill_history.py --rebuild-changes"
        )
    print("下一步（由 User 或授權 session 執行）：")
    print("  uv run python scripts/backfill_aggregates.py")
    print(
        "  uv run python -c \"import datetime as dt; "
        "from activeetf import db, metrics; "
        "d=max(db.snapshot_trading_dates(dt.date.today())); "
        "metrics.refresh_open_positions(d); metrics.compute_all(d)\""
    )


if __name__ == "__main__":
    main()
