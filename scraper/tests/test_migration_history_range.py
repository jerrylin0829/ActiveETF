from pathlib import Path


MIGRATION = (
    Path(__file__).parents[1]
    / "migrations"
    / "006_etf_history_range_view.sql"
)


def test_history_range_view_is_read_only_and_security_invoker():
    sql = MIGRATION.read_text()

    assert "create view dashboard_etf_history_range" in sql
    assert "security_invoker = true" in sql
    assert "min(trade_date) as history_from" in sql
    assert "max(trade_date) as history_to" in sql
    assert "grant select on dashboard_etf_history_range to anon, authenticated" in sql
