"""相鄰兩日快照 diff → 異動事件。
ADD/TRIM 需「股數變化」與「|權重變化| >= 0.05pp」同時成立（spec §5）：
申贖造成的等比例股數變動權重幾乎不動，會被權重門檻自然過濾。
NEW/EXIT 無門檻——進出本身就是訊號。"""
from activeetf.models import Holding, Change

WEIGHT_DELTA_MIN_PP = 0.05

def diff_snapshots(prev: dict[str, Holding], curr: dict[str, Holding]) -> list[Change]:
    changes: list[Change] = []
    for sid, h in curr.items():
        p = prev.get(sid)
        if p is None:
            changes.append(Change(sid, "NEW", h.shares, h.weight_pct))
            continue
        ds = h.shares - p.shares
        dw = h.weight_pct - p.weight_pct
        if ds != 0 and abs(dw) >= WEIGHT_DELTA_MIN_PP:
            changes.append(Change(sid, "ADD" if ds > 0 else "TRIM", ds, dw))
    for sid, p in prev.items():
        if sid not in curr:
            changes.append(Change(sid, "EXIT", -p.shares, -p.weight_pct))
    return sorted(changes, key=lambda c: c.stock_id)
