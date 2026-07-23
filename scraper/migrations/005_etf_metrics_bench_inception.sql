-- 005_etf_metrics_bench_inception.sql - spec §6 同期 0050 上市以來報酬
alter table etf_metrics
  add column if not exists bench_0050_inception numeric;
