-- 003_cross_holdings_rotation.sql - spec 2026-07-16 §3
create table cross_holdings_daily (
  trade_date       date not null,
  stock_id         text not null,
  etf_count        int not null,               -- covering active-ETF count
  total_weight_pct numeric(10,4) not null,     -- sum of per-ETF weights (%)
  total_shares     bigint not null,            -- sum of shares
  total_value_twd  numeric(20,2),              -- sum(shares * close), TWD; null if price missing
  new_count  int not null default 0,           -- ETFs with NEW event that day
  add_count  int not null default 0,
  trim_count int not null default 0,
  exit_count int not null default 0,
  primary key (trade_date, stock_id)
);

create table industry_weight_daily (
  trade_date       date not null,
  industry         text not null,              -- stock_info.industry; blank -> '未分類'
  sum_weight_pct   numeric(12,4) not null,     -- sum over all active ETFs (%)
  stock_count      int not null,               -- distinct stocks held in this industry
  etf_count_total  int not null,               -- ETFs with a snapshot that day (avg denominator)
  primary key (trade_date, industry)
);

do $$ declare t text;
begin
  foreach t in array array['cross_holdings_daily','industry_weight_daily'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_read on %I for select using (true)', t, t);
  end loop;
end $$;

-- bounded date lookup for the /cross date selector (follows 002 pattern)
create view dashboard_cross_dates
with (security_invoker = true) as
select distinct trade_date
from cross_holdings_daily;

grant select on dashboard_cross_dates to anon, authenticated;
