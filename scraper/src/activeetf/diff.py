"""相鄰兩日快照 diff → 異動事件。
ADD/TRIM 需「股數變化」與「|權重變化| >= 0.05pp」同時成立（spec §5）：
申贖造成的等比例股數變動權重幾乎不動，會被權重門檻自然過濾。
快照完全新增／移除的 NEW/EXIT 無門檻；觀察／實質跨界仍套用上述雙門檻，
避免上游四捨五入製造假進出。"""
from activeetf.models import Holding, Change

WEIGHT_DELTA_MIN_PP = 0.05


def _is_observation(holding: Holding) -> bool:
    return holding.weight_pct == 0


def _passes_change_threshold(previous: Holding, current: Holding) -> bool:
    return (
        current.shares != previous.shares
        and abs(current.weight_pct - previous.weight_pct) >= WEIGHT_DELTA_MIN_PP
    )


def diff_snapshots(prev: dict[str, Holding], curr: dict[str, Holding]) -> list[Change]:
    changes: list[Change] = []
    for sid, h in curr.items():
        p = prev.get(sid)
        if _is_observation(h):
            if (
                p is not None
                and not _is_observation(p)
                and _passes_change_threshold(p, h)
            ):
                changes.append(
                    Change(
                        sid,
                        "EXIT",
                        h.shares - p.shares,
                        h.weight_pct - p.weight_pct,
                    )
                )
            continue
        if p is None:
            changes.append(Change(sid, "NEW", h.shares, h.weight_pct))
            continue
        if _is_observation(p):
            if not _passes_change_threshold(p, h):
                continue
            changes.append(
                Change(
                    sid,
                    "NEW",
                    h.shares - p.shares,
                    h.weight_pct - p.weight_pct,
                )
            )
            continue
        ds = h.shares - p.shares
        dw = h.weight_pct - p.weight_pct
        if _passes_change_threshold(p, h):
            changes.append(Change(sid, "ADD" if ds > 0 else "TRIM", ds, dw))
    for sid, p in prev.items():
        if sid not in curr and not _is_observation(p):
            changes.append(Change(sid, "EXIT", -p.shares, -p.weight_pct))
    return sorted(changes, key=lambda c: c.stock_id)
