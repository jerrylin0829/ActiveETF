-- 各 ETF 的持股歷史起訖。直接衍生自 append-only 快照，
-- 回補延伸或資料修正後會自動反映。
create view dashboard_etf_history_range
with (security_invoker = true) as
select etf_id,
       min(trade_date) as history_from,
       max(trade_date) as history_to
from holdings_snapshot
group by etf_id;

grant select on dashboard_etf_history_range to anon, authenticated;
