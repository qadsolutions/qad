-- M2 (#21): operational tables — retrieval_logs, model_calls, audit_logs, settings.
--
-- Same isolation model as the M1/M2 tables (20260615000001, 20260617000002):
-- every table carries tenant_id, RLS is enabled, and the only authenticated-facing
-- policy is a tenant-scoped SELECT. All writes (RAG logging, audit, settings) happen
-- server-side via service_role, which bypasses RLS — granted explicitly here since
-- RLS bypass does not imply table privileges (the gap 20260616000002 had to fix).
--
-- Authoritative shape: CLAUDE.md "Database Schema" + SECURITY.md §5, which are more
-- detailed than issue #21's abbreviated AC list. Notable divergences from the issue
-- body, taken from those specs:
--   * audit_logs.tenant_id is NULLABLE (Option A, decided 2026-06-17) — it records the
--     tenant an action *affected*; a fleet-wide platform_admin action stores NULL.
--     user_id is NOT NULL (the actor is always known).
--   * audit_logs has a resource_id column (the issue body omits it).
-- The standard tenant-scoped SELECT policy handles nullable tenant_id with no special
-- casing: SQL three-valued logic means a NULL tenant_id row never equals any tenant's
-- JWT claim, so it is invisible to every tenant-scoped client and reachable only via
-- service_role (the platform console, M11).
--
-- OUT OF SCOPE (deferred to M9, per issue #21's own Notes): audit-log immutability
-- (UPDATE/DELETE restriction), the 90-day retention job, and the "NULL tenant_id ⇒
-- actor is platform_admin" write-path invariant. SECURITY.md §5 describes those, but
-- this issue only creates the table with the right shape, RLS, and grants. audit_logs
-- therefore gets the same standard service_role grant as every other table; M9 will
-- tighten it.

-- ---------------------------------------------------------------------------
-- messages (id, tenant_id) uniqueness — enables retrieval_logs' composite FK.
--
-- retrieval_logs denormalizes tenant_id from its message (so log-level RLS needs no
-- join), exactly like document_chunks/messages do from their parents (#78). On a plain
-- single-column message_id FK nothing stops the copy from disagreeing with the message's
-- tenant_id, and since all writes go through service_role (RLS-bypassing), a server-side
-- bug is the only thing between a mismatched row and a cross-tenant leak. messages did
-- not previously carry a (id, tenant_id) unique constraint, so we add it here so the
-- child FK can target the pair — making a mismatched tenant_id a constraint violation
-- rather than a latent bug. Same DB-as-backstop-for-service_role-writes reasoning as the
-- composite FKs in 20260617000002 and the platform_admin CHECKs in 20260617000001.
-- ---------------------------------------------------------------------------

alter table public.messages
  add constraint messages_id_tenant_uq unique (id, tenant_id);

-- ---------------------------------------------------------------------------
-- retrieval_logs
-- One row per RAG retrieval, linked to the assistant message it produced. Records
-- which chunks were retrieved and their similarity scores (parallel arrays).
-- ---------------------------------------------------------------------------

create table public.retrieval_logs (
  id                uuid              primary key default gen_random_uuid(),
  message_id        uuid              not null,
  tenant_id         uuid              not null references public.tenants (id) on delete cascade,
  chunk_ids         uuid[]            not null,
  similarity_scores double precision[] not null,
  created_at        timestamptz       not null default now(),
  -- Composite FK (not a plain message_id FK) so a log's tenant_id can never disagree
  -- with its message's tenant_id — see the messages_id_tenant_uq note above.
  constraint retrieval_logs_msg_tenant_fk
    foreign key (message_id, tenant_id) references public.messages (id, tenant_id) on delete cascade,
  -- chunk_ids and similarity_scores are positionally-paired parallel arrays (the i-th
  -- score belongs to the i-th chunk). Nothing else enforces that pairing, so a length
  -- mismatch would silently misalign scores; require equal cardinality at the DB layer.
  constraint retrieval_logs_arrays_same_length
    check (cardinality(chunk_ids) = cardinality(similarity_scores))
);

create index retrieval_logs_tenant_id_idx on public.retrieval_logs (tenant_id);
create index retrieval_logs_message_id_idx on public.retrieval_logs (message_id);

alter table public.retrieval_logs enable row level security;

create policy "retrieval_logs: select own tenant"
  on public.retrieval_logs
  for select
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- model_calls
-- One row per inference call, for usage accounting and latency monitoring.
-- ---------------------------------------------------------------------------

create table public.model_calls (
  id                uuid        primary key default gen_random_uuid(),
  tenant_id         uuid        not null references public.tenants (id) on delete cascade,
  -- on delete set null (not cascade): a usage/billing row must outlive the user who
  -- made the call — deleting a user must not erase their usage history. model_calls is
  -- NOT a compliance-mandated immutable log (unlike audit_logs, see §5 below), so simply
  -- dropping the actor link (nullable + set null) is sufficient here; the accounting row
  -- survives with user_id NULL.
  user_id           uuid        references public.users (id) on delete set null,
  model_name        text        not null,
  prompt_tokens     integer     not null,
  completion_tokens integer     not null,
  latency_ms        integer     not null,
  created_at        timestamptz not null default now(),
  -- Token/latency counts are physically non-negative; reject negative values rather
  -- than letting a buggy writer poison usage accounting.
  constraint model_calls_nonnegative_counts
    check (prompt_tokens >= 0 and completion_tokens >= 0 and latency_ms >= 0)
);

create index model_calls_tenant_id_idx on public.model_calls (tenant_id);
create index model_calls_user_id_idx on public.model_calls (user_id);

alter table public.model_calls enable row level security;

create policy "model_calls: select own tenant"
  on public.model_calls
  for select
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- audit_logs
-- Append-only record of every query, document access, admin action, and model
-- call (SECURITY.md §5). tenant_id is NULLABLE (Option A): it records the tenant
-- an action affected; a fleet-wide platform_admin action stores NULL. user_id is
-- NOT NULL — the actor is always known. resource_id is nullable (not every action
-- targets a single resource). Immutability/retention hardening is M9, not here —
-- but the FK delete actions below are part of that immutability invariant: an audit
-- row may never be silently destroyed by deleting its tenant or actor (see §5,
-- "There is no ad-hoc delete path"), so neither FK is ON DELETE CASCADE.
-- ---------------------------------------------------------------------------

create table public.audit_logs (
  id            uuid        primary key default gen_random_uuid(),
  -- on delete set null (NOT cascade): audit_logs is append-only/immutable
  -- (SECURITY.md §5) — "There is no ad-hoc delete path." A tenant CASCADE delete would
  -- silently destroy that tenant's compliance record. SET NULL is safe because tenant_id
  -- is already nullable with documented fleet-wide (NULL) semantics, so a deleted tenant's
  -- rows simply become tenant-less audit history rather than disappearing.
  tenant_id     uuid        references public.tenants (id) on delete set null,
  -- on delete restrict (NOT cascade, NOT set null): SECURITY.md §5 — "user_id is always
  -- set, so actor attribution is never lost." Keep NOT NULL and block the user delete
  -- entirely; deleting an actor who has audit rows must go through an explicit teardown
  -- path, never silently drop the actor link or the row.
  user_id       uuid        not null references public.users (id) on delete restrict,
  action        text        not null,
  resource_type text        not null,
  resource_id   uuid,
  ip_address    inet,
  created_at    timestamptz not null default now()
);

create index audit_logs_tenant_id_idx on public.audit_logs (tenant_id);
-- The M9 90-day retention sweep deletes by age (DELETE ... WHERE created_at < ...);
-- index created_at so that scan is not a full table scan.
create index audit_logs_created_at_idx on public.audit_logs (created_at);

alter table public.audit_logs enable row level security;

-- Standard tenant-scoped SELECT. Nullable tenant_id needs no special casing:
-- NULL = <jwt tenant_id> is never true, so fleet-wide (NULL) rows are invisible to
-- every tenant client and surface only via service_role (the platform console, M11).
create policy "audit_logs: select own tenant"
  on public.audit_logs
  for select
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- settings
-- Per-tenant key/value configuration. value is jsonb (matching tenants.settings's
-- JSONB convention). A tenant has at most one row per key (settings_tenant_key_uq).
-- updated_by is a nullable FK to the user who last wrote the setting.
-- ---------------------------------------------------------------------------

create table public.settings (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants (id) on delete cascade,
  key        text        not null,
  value      jsonb       not null,
  updated_by uuid        references public.users (id),
  created_at timestamptz not null default now(),
  constraint settings_tenant_key_uq unique (tenant_id, key)
);

create index settings_tenant_id_idx on public.settings (tenant_id);

alter table public.settings enable row level security;

create policy "settings: select own tenant"
  on public.settings
  for select
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Grants
-- anon has no access (no policies, no grants). authenticated is scoped by the RLS
-- policies above. service_role bypasses RLS entirely and is the only write path
-- (RAG logging, audit, settings) — granted explicitly since RLS bypass does not
-- imply table privileges. M9 will tighten audit_logs' grant (immutability/retention).
-- ---------------------------------------------------------------------------

grant select on public.retrieval_logs to authenticated;
grant select on public.model_calls    to authenticated;
grant select on public.audit_logs     to authenticated;
grant select on public.settings       to authenticated;

grant select, insert, update, delete on public.retrieval_logs to service_role;
grant select, insert, update, delete on public.model_calls    to service_role;
grant select, insert, update, delete on public.audit_logs     to service_role;
grant select, insert, update, delete on public.settings       to service_role;
