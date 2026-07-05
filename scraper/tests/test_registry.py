from activeetf.registry import entries, by_id


def test_registry_complete():
    es = entries()
    assert len(es) == 28
    assert len({e.etf_id for e in es}) == 28
    assert all(e.etf_id.endswith("A") for e in es)
    assert all(e.universe in ("tw", "global") for e in es)


def test_by_id():
    assert by_id("00992A").adapter == "capital"
    assert by_id("00992A").pcf_url is not None
