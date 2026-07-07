-- 001_schema.sql - spec §4
create table etf (
  etf_id      text primary key,
  name        text not null,
  issuer      text not null,
  listed_date date,
  pcf_url     text,
  universe    text not null default 'tw' check (universe in ('tw','global'))
);

create table holdings_snapshot (
  etf_id     text not null references etf,
  trade_date date not null,
  stock_id   text not null,
  shares     bigint not null,
  weight_pct numeric(8,4) not null,
  primary key (etf_id, trade_date, stock_id)
);

create table holding_change (
  etf_id           text not null references etf,
  trade_date       date not null,
  stock_id         text not null,
  change_type      text not null check (change_type in ('NEW','ADD','TRIM','EXIT')),
  shares_delta     bigint not null,
  weight_delta_pct numeric(8,4) not null,
  primary key (etf_id, trade_date, stock_id)
);

create table stock_info (
  stock_id text primary key,
  name     text not null,
  industry text,
  market   text
);

create table stock_price (
  stock_id   text not null,
  trade_date date not null,
  close      numeric(14,4),
  adj_close  numeric(14,4),
  primary key (stock_id, trade_date)
);

create table etf_metrics (
  etf_id                text not null references etf,
  trade_date            date not null,
  ret_1m numeric, ret_3m numeric, ret_6m numeric, ret_1y numeric, ret_inception numeric,
  bench_0050_1m numeric, bench_0050_3m numeric, bench_0050_6m numeric, bench_0050_1y numeric,
  timing_wins int, timing_months int,
  picking_realized_wins int, picking_realized_total int,
  picking_open_wins int, picking_open_total int,
  median_holding_days numeric,
  weekly_turnover_pct numeric,
  primary key (etf_id, trade_date)
);

create table scrape_log (
  id         bigint generated always as identity primary key,
  etf_id     text not null,
  trade_date date not null,
  run_at     timestamptz not null default now(),
  status     text not null check (status in ('ok','fail')),
  error      text
);
create index scrape_log_lookup on scrape_log (etf_id, trade_date, status);

-- RLS: anonymous read-only for the dashboard; writes use direct connection/service key.
do $$ declare t text;
begin
  foreach t in array array['etf','holdings_snapshot','holding_change','stock_info','stock_price','etf_metrics','scrape_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_read on %I for select using (true)', t, t);
  end loop;
end $$;
