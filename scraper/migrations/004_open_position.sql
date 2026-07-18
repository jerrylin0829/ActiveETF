-- 004_open_position.sql - handoff 2026-07-17 radar-excess-return §2
-- All open NEW→(not yet EXIT) rounds, rebuilt daily. The radar view is the
-- holding_days < 20 slice; the ETF detail page (slice 4) reads the full table.
create table open_position (
  etf_id            text not null references etf,
  stock_id          text not null,
  entry_date        date not null,            -- NEW event date of the current round
  as_of_date        date not null,            -- last recompute date
  holding_days      int not null,             -- trading days since entry (entry day = 0)
  stock_return_pct  numeric(10,4),            -- adj-close return %, entry -> as_of
  bench_return_pct  numeric(10,4),            -- TAIEX_TRI return %, same window
  excess_return_pct numeric(10,4),            -- stock - bench; null if unpriceable
  primary key (etf_id, stock_id, entry_date)
);

alter table open_position enable row level security;
create policy open_position_read on open_position for select using (true);
