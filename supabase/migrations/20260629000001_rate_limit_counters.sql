-- M4 (#62): per-tenant/per-user RAG query rate limiting — durable, multi-instance-correct.
--
-- WHY POSTGRES (not Redis/Upstash). The query limiter exists to keep us under Groq's
-- free-tier limits; those limits disappear at the M5 Ollama cutover, so this counter is
-- partly throwaway. A second piece of infra (new vendor, new secret, new failure mode)
-- to optimize a throwaway counter is backwards, and at 10–40 tenants there is no write
-- contention to make Redis's atomic counters meaningfully better — per-tenant/per-user
-- row contention only bites at high write rates on the SAME row, which is not our world.
-- Postgres is also the correct home if this ever feeds usage metering: that data wants to
-- live durably next to the tenant rows. No privacy concern either way — we store counts,
-- not document content. All access goes through one function (increment_rate_limit) so a
-- future swap to Redis, if volume ever demands it, is a one-function change.
--
-- The upload limiter (#62, RATE_LIMIT_UPLOADS_PER_DAY) needs no table at all: it counts
-- the tenant's own `documents` rows in the trailing 24h (src/lib/rate-limit.ts). This
-- table is only for the query limiter, which has no per-query row to count yet
-- (model_calls/messages arrive with #30/#31).

-- ---------------------------------------------------------------------------
-- rate_limit_counters
-- One row per (tenant, user, scope, aligned-window). `scope` distinguishes limit kinds
-- ('query' today) so the same table can back future limits without a schema change.
-- The increment function (below) keeps this table to ~one live row per active subject by
-- self-pruning expired windows, so it never grows unbounded.
-- ---------------------------------------------------------------------------

create table public.rate_limit_counters (
  tenant_id    uuid        not null references public.tenants (id) on delete cascade,
  user_id      uuid        not null references public.users (id)   on delete cascade,
  scope        text        not null,
  -- Start of the aligned fixed window this count belongs to (floor(now / window)).
  window_start timestamptz not null,
  count        integer     not null default 0,
  -- A counter is uniquely identified by its subject + scope + window, so that tuple is
  -- the PK — this is exactly the ON CONFLICT target the atomic upsert below relies on.
  primary key (tenant_id, user_id, scope, window_start),
  -- Counts are physically non-negative; reject a negative value rather than letting a
  -- buggy writer poison the limiter (mirrors model_calls_nonnegative_counts).
  constraint rate_limit_counters_nonnegative_count check (count >= 0)
);

-- Index user_id (not tenant_id): a user delete cascades to this table, and user_id is
-- NOT a leading column of the PK, so without this index that cascade sequential-scans.
-- tenant_id needs no standalone index here — it is the PK's leading column, so the PK
-- btree already serves tenant-scoped lookups (the RLS predicate, usage reads). This is
-- unlike model_calls/conversations/users, whose PK is `id`, so they index tenant_id.
create index rate_limit_counters_user_id_idx on public.rate_limit_counters (user_id);

alter table public.rate_limit_counters enable row level security;

-- Standard tenant-scoped SELECT (consistent with every other table). The limiter writes
-- via service_role; this policy only exists so a tenant could read its own usage later.
create policy "rate_limit_counters: select own tenant"
  on public.rate_limit_counters
  for select
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- anon: no access. authenticated: tenant-scoped SELECT only (above). service_role: the
-- only write path (the limiter), granted explicitly since RLS bypass ≠ table privileges.
grant select on public.rate_limit_counters to authenticated;
grant select, insert, update, delete on public.rate_limit_counters to service_role;

-- ---------------------------------------------------------------------------
-- increment_rate_limit — atomic windowed counter.
--
-- The single seam all rate-limit reads/writes go through (see the WHY POSTGRES note).
-- Atomically bumps the current window's count and returns it, so concurrent requests on
-- the same row can never lose an increment (the read-modify-write happens inside one
-- UPDATE under a row lock — the race a naive SELECT-then-UPDATE in app code would have).
--
-- Returns the post-increment count and the window's reset time. The caller (TS) compares
-- the count against the configured limit, so this function stays limit-agnostic.
--
-- SECURITY INVOKER + granted to service_role only: writes are service_role-only by
-- convention, and the caller passes the validated tenant_id/user_id from the verified
-- JWT — never request-body values (same contract as match_chunks' service_role path).
-- search_path = '' pins resolution; public objects are fully qualified, built-ins resolve
-- from pg_catalog.
-- ---------------------------------------------------------------------------

create or replace function public.increment_rate_limit(
  p_tenant_id      uuid,
  p_user_id        uuid,
  p_scope          text,
  p_window_seconds integer
)
returns table (current_count integer, reset_at timestamptz)
language plpgsql
volatile           -- writes rows; STABLE/IMMUTABLE would be wrong
security invoker
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count        integer;
begin
  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'p_window_seconds must be a positive integer, got %', p_window_seconds;
  end if;

  -- Aligned fixed window: floor now() to a p_window_seconds boundary so every request in
  -- the same wall-clock window shares one counter row (rather than a per-request anchor).
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_counters as c
    (tenant_id, user_id, scope, window_start, count)
  values (p_tenant_id, p_user_id, p_scope, v_window_start, 1)
  on conflict (tenant_id, user_id, scope, window_start)
  do update set count = c.count + 1
  returning c.count into v_count;

  -- Self-prune this subject's expired windows so the table stays ~one live row per active
  -- (tenant, user, scope) with no cron job. Safe to drop: the rate-limit counter is
  -- throwaway (gone at the M5 Ollama cutover); durable usage metering lives in model_calls.
  delete from public.rate_limit_counters
  where tenant_id = p_tenant_id
    and user_id   = p_user_id
    and scope     = p_scope
    and window_start < v_window_start;

  current_count := v_count;
  reset_at      := v_window_start + make_interval(secs => p_window_seconds);
  return next;
end;
$$;

-- Revoke the default PUBLIC EXECUTE first so the function is never callable by a
-- tenant-facing client (anon/authenticated), then grant only service_role — the query
-- limiter calls it via the service-role admin client. Same posture as
-- reingest_document_chunks (20260622000001) and custom_access_token_hook (20260616000001).
revoke all on function public.increment_rate_limit(uuid, uuid, text, integer)
  from public, anon, authenticated;

grant execute on function public.increment_rate_limit(uuid, uuid, text, integer)
  to service_role;
