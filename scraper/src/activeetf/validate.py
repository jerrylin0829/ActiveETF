"""入庫前三道驗證（spec §5）。任一不過 = 整檔不寫入。錯資料比缺資料危險。"""
import datetime as dt
import math

from activeetf.models import Holding

WEIGHT_SUM_MIN, WEIGHT_SUM_MAX = 70.0, 101.0   # 現金部位會吃掉一些權重
COUNT_COLLAPSE_RATIO = 0.5                      # 筆數 < 前日一半 = 解析到一半

class ValidationError(Exception):
    pass


class SourceDateMismatch(ValidationError):
    """上游回傳的資料日不等於要寫入的 trade_date。"""


def validate_source_date(source_date: dt.date | None, trade_date: dt.date) -> None:
    """回補專用第四道：擋掉「抓到的是別天的持股」。

    三道驗證看不出日期錯位（權重、筆數、代號都正常），錯位卻會讓整段歷史的
    異動事件失真。故寫入前一律以上游自報的資料日核對，沒有資料日也不放行。
    """
    if source_date != trade_date:
        raise SourceDateMismatch(
            f"source date {source_date} != trade date {trade_date}"
        )

def validate(holdings: list[Holding], prev_count: int | None,
             known_ids: set[str], universe: str) -> None:
    if not holdings:
        raise ValidationError("empty holdings")
    invalid_weights = []
    for holding in holdings:
        try:
            valid = math.isfinite(holding.weight_pct) and holding.weight_pct >= 0
        except TypeError:
            valid = False
        if not valid:
            invalid_weights.append(holding.stock_id)
    if invalid_weights:
        raise ValidationError(f"invalid weight_pct: {invalid_weights[:5]}")
    total = sum(h.weight_pct for h in holdings)
    if not (WEIGHT_SUM_MIN <= total <= WEIGHT_SUM_MAX):
        raise ValidationError(f"weight sum {total:.2f} outside [{WEIGHT_SUM_MIN},{WEIGHT_SUM_MAX}]")
    if prev_count is not None and len(holdings) < prev_count * COUNT_COLLAPSE_RATIO:
        raise ValidationError(f"count collapse: {len(holdings)} vs prev {prev_count}")
    if universe == "tw":
        unknown = sorted(h.stock_id for h in holdings if h.stock_id not in known_ids)
        if unknown:
            raise ValidationError(f"unknown stock ids: {unknown[:5]}")
