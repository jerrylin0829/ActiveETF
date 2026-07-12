from dataclasses import dataclass

@dataclass(frozen=True)
class Holding:
    stock_id: str
    shares: int
    weight_pct: float

@dataclass(frozen=True)
class Change:
    stock_id: str
    change_type: str  # NEW / ADD / TRIM / EXIT
    shares_delta: int
    weight_delta_pct: float
