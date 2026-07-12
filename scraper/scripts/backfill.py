"""One-time adjusted price backfill for launch day (spec §8)."""
import datetime as dt
import time

from activeetf import db, finmind
from activeetf.registry import entries

START = "2025-05-01"


def main(start: str = START, today: dt.date | None = None) -> None:
    end = str(today or dt.date.today())
    targets = [e.etf_id for e in entries()] + ["0050"]
    for sid in targets:
        rows = finmind.adj_prices(sid, start, end)
        db.upsert_prices([(r["stock_id"], r["date"], None, r["close"]) for r in rows])
        print(f"{sid}: {len(rows)} rows")
        time.sleep(1)

    tri = finmind.total_return_index(start, end)
    db.upsert_prices([(finmind.TAIEX_TRI, r["date"], None, r["price"]) for r in tri])
    print(f"{finmind.TAIEX_TRI}: {len(tri)} rows")


if __name__ == "__main__":
    main()
