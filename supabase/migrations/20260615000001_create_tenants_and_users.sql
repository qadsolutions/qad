-- M1: tenants + users tables with RLS
-- Enforces tenant isolation at the database layer.
-- All reads are scoped to the authenticated user's tenant_id JWT claim.
-- Writes use the service_role key server-side and bypass RLS — no client-facing
-- insert/update policies are needed here (added in later milestones).

-- ---------------------------------------------------------------------------
-- tenants
-- One row per client business.
-- ---------------------------------------------------------------------------

create table public.tenants (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  slug       text        not null unique,
  plan_tier  text        not null default 'starter',
  is_active  boolean     not null default true,
  settings   jsonb       not null default '{}',
  created_at timestamptz not null default now()
);

-- Fast slug lookup (login page, subdomain routing)
create index tenants_slug_idx on public.tenants (slug);

alter table public.tenants enable row level security;

-- A user may read only the tenant row whose id matches their JWT tenant_id claim.
create policy "tenants: select own tenant"
  on public.tenants
  for select
  using (id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- users (public profile, linked to auth.users)
-- One row per person; references auth.users so auth events cascade correctly.
-- ---------------------------------------------------------------------------

create table public.users (
  id         uuid        primary key references auth.users (id) on delete cascade,
  tenant_id  uuid        not null references public.tenants (id) on delete cascade,
  email      text        not null,
  role       text        not null check (role in ('admin', 'user', 'platform_admin')),
  created_at timestamptz not null default now()
);

-- Fast per-tenant user lookups
create index users_tenant_id_idx on public.users (tenant_id);

alter table public.users enable row level security;

-- A user may read only rows where tenant_id matches their JWT tenant_id claim.
create policy "users: select own tenant"
  on public.users
  for select
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
