"""入庫前三道驗證（spec §5）。任一不過 = 整檔不寫入。錯資料比缺資料危險。"""
from activeetf.models import Holding

WEIGHT_SUM_MIN, WEIGHT_SUM_MAX = 70.0, 101.0   # 現金部位會吃掉一些權重
COUNT_COLLAPSE_RATIO = 0.5                      # 筆數 < 前日一半 = 解析到一半

class ValidationError(Exception):
    pass

def validate(holdings: list[Holding], prev_count: int | None,
             known_ids: set[str], universe: str) -> None:
    if not holdings:
        raise ValidationError("empty holdings")
    total = sum(h.weight_pct for h in holdings)
    if not (WEIGHT_SUM_MIN <= total <= WEIGHT_SUM_MAX):
        raise ValidationError(f"weight sum {total:.2f} outside [{WEIGHT_SUM_MIN},{WEIGHT_SUM_MAX}]")
    if prev_count is not None and len(holdings) < prev_count * COUNT_COLLAPSE_RATIO:
        raise ValidationError(f"count collapse: {len(holdings)} vs prev {prev_count}")
    if universe == "tw":
        unknown = sorted(h.stock_id for h in holdings if h.stock_id not in known_ids)
        if unknown:
            raise ValidationError(f"unknown stock ids: {unknown[:5]}")
