---
name: new-adapter
description: Use when adding or repairing ActiveETF issuer PCF adapters, official-site holding parsers, fixtures, registry entries, or adapter smoke tests.
---

# New Adapter

## Overview

Build one issuer adapter at a time from official PCF/holdings pages only. The invariant loop is: discover source, record fixture, write failing tests, implement parser/fetch, live smoke, update registry and plan, commit.

## Required Context

- Read `AGENTS.md` and `docs/superpowers/specs/2026-07-04-active-etf-tracker-design.md` before changing adapter behavior.
- Use `docs/superpowers/plans/2026-07-04-data-pipeline.md` Task 12 as the progress tracker.
- Use `superpowers:test-driven-development` before implementation code.

## Workflow

1. Pick one issuer with unimplemented `registry.py` entries. Prefer static HTML or JSON endpoints before JS-only sites.
2. Discover the official holdings source. PCF/holdings must come from the issuer website; do not substitute FinMind, TWSE, SITCA, third-party ETF sites, or monthly PDFs unless the spec is changed first.
3. Save one real fixture under `scraper/tests/fixtures/<issuer>_<etf_id>.<html|json>`.
4. Add `scraper/tests/test_adapter_<issuer>.py` first. At minimum assert:
   - parsed holdings count is plausible (`>= 10`);
   - total weight is within `70 <= total <= 101`;
   - every holding has stock id, positive shares, and sensible weight;
   - stock ids are unique;
   - `fetch()` calls the expected official URL or API payload.
5. Run the new test and confirm the expected failure before implementation.
6. Implement `scraper/src/activeetf/adapters/<issuer>.py` with `parse()` plus `fetch(entry)`. Keep parser logic local to the issuer and return `Holding` objects only.
7. Update `scraper/src/activeetf/registry.py` for all ETFs that the adapter covers: `pcf_url`, `adapter`, and `universe` if discovery proves it.
8. Run issuer tests, a live smoke for every ETF covered by that adapter, then full `uv run pytest -v`.
9. Update Task 12 with issuer, ETF ids, source type, live smoke counts/weights, and remaining ETF count.
10. Commit one issuer at a time: `feat: <投信> adapter（N 檔主動式 ETF）`.

## Live Smoke

Use this pattern after tests pass:

```bash
cd scraper
uv run python - <<'PY'
from activeetf.registry import by_id
from activeetf.adapters import base

for etf_id in ["00980A"]:
    entry = by_id(etf_id)
    hs = base.load(entry.adapter).fetch(entry)
    print(etf_id, len(hs), round(sum(h.weight_pct for h in hs), 2), hs[:3])
PY
```

The result is acceptable only when each ETF has more than 10 rows and total weight is 70-101. If a page is blocked, guarded by cookies, or requires a browser session, document that blocker in Task 12 instead of guessing.

## Common Mistakes

- Do not silently normalize global stock ids into Taiwan ids. Only strip suffixes such as ` TT` when the registry universe is `tw`.
- Do not accept top-10 holdings pages when total weight fails the 70-101 validation.
- Do not broaden shared validation rules to make one issuer pass; fix the adapter or document the source blocker.
- Do not batch multiple issuers in one commit.
