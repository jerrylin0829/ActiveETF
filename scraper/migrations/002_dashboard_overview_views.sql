-- 002_dashboard_overview_views.sql - Dashboard 今日總覽 bounded date lookups
create view dashboard_holding_change_dates
with (security_invoker = true) as
select distinct trade_date
from holding_change;

create view dashboard_holding_snapshot_dates
with (security_invoker = true) as
select distinct trade_date
from holdings_snapshot;

grant select on dashboard_holding_change_dates to anon, authenticated;
grant select on dashboard_holding_snapshot_dates to anon, authenticated;
