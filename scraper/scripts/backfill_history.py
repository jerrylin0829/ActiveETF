"""One-off 歷史 PCF 回補（spec 2026-07-25）。

只處理實作 fetch_at 的 adapter；已有快照直接跳過，三道驗證不放寬。
回補與正式 migration 僅由 User 或明確授權 session 執行。
"""

import datetime as dt
import argparse
import time
import traceback
from collections.abc import Iterable, Sequence
from zoneinfo import ZoneInfo

from activeetf import db, metrics
from activeetf.adapters import base as adapter_base
from activeetf.backfill import backfill_targets
from activeetf.diff import diff_snapshots
from activeetf.models import Change, Holding
from activeetf.registry import EtfEntry, entries
from activeetf.validate import ValidationError, validate

PAUSE_SECONDS = 2.0


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
    args = parser.parse_args(argv)
    if (args.etf_id is None) != (args.date is None):
        parser.error("--etf-id 與 --date 必須一起提供")
    return args


def _today() -> dt.date:
    return dt.datetime.now(ZoneInfo("Asia/Taipei")).date()


def discover_adapters(
    registry_entries: Iterable[EtfEntry],
) -> tuple[dict[str, tuple[EtfEntry, object]], list[str]]:
    """Split registry entries by the optional historical-fetch capability."""
    supported: dict[str, tuple[EtfEntry, object]] = {}
    skipped: list[str] = []
    for entry in registry_entries:
        if not entry.adapter:
            continue
        module = adapter_base.load(entry.adapter)
        if adapter_base.supports_history(module):
            supported[entry.etf_id] = (entry, module)
        else:
            skipped.append(f"{entry.etf_id}({entry.adapter})")
    return supported, skipped


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
    if canary:
        trading_dates = db.benchmark_trading_dates(args.date, args.date)
        if args.date not in trading_dates:
            raise SystemExit(f"指定日期不是 0050 有效交易日：{args.date}")
    else:
        trading_dates = db.benchmark_trading_dates(
            min(listing_dates.values()),
            _today(),
        )
    existing = db.existing_snapshot_keys(eligible_ids)
    all_targets = backfill_targets(
        trading_dates,
        listing_dates,
        set(),
    )
    targets = backfill_targets(trading_dates, listing_dates, existing)
    skipped_existing = len(all_targets) - len(targets)
    estimated_minutes = len(targets) * PAUSE_SECONDS / 60
    print(
        f"待抓 {len(targets)} 筆、已有快照跳過 {skipped_existing} 筆，"
        f"預估 {estimated_minutes:.0f} 分鐘\n"
    )

    known_ids = db.known_stock_ids() if targets else set()
    ok = validation_failed = fetch_failed = 0
    for index, (etf_id, trade_date) in enumerate(targets, 1):
        entry, module = supported[etf_id]
        try:
            holdings = module.fetch_at(entry, trade_date)
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

    if not canary:
        print("\n重建 holding_change：")
        rebuild_holding_changes(eligible_ids)
    else:
        print("Canary 完成：未重建 holding_change；可確認 fetch、validation、snapshot/log 行為。")
    print(
        f"\n完成：成功 {ok}、已有快照跳過 {skipped_existing}、"
        f"驗證失敗 {validation_failed}、抓取失敗 {fetch_failed}"
        "（失敗明細見 scrape_log）"
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
