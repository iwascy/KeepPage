create table if not exists rate_limit_buckets (
  scope text not null,
  bucket_key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (scope, bucket_key, window_start)
);

create index if not exists rate_limit_buckets_window_idx on rate_limit_buckets (window_start);
