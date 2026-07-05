"""群益 adapter 不變量測試：以 fixture JSON 驗證 parse 行為，不做真連線。"""
import json
from pathlib import Path

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "capital_00992A.json"


def test_parses_fixture_into_plausible_holdings():
    from activeetf.adapters import capital

    payload = json.loads(FIXTURE.read_text())
    holdings = capital.parse(payload)

    assert len(holdings) >= 10
    total = sum(h.weight_pct for h in holdings)
    assert 70 <= total <= 101, f"weight sum out of range: {total}"
    for h in holdings:
        assert h.stock_id, f"empty stock_id: {h}"
        assert h.shares > 0, f"non-positive shares: {h}"
        assert 0 < h.weight_pct < 60, f"weight out of bounds: {h}"
    assert len({h.stock_id for h in holdings}) == len(holdings), "duplicate stock_ids"
