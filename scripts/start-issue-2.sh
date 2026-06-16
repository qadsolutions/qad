#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Issue #2 — Create `tenants` + `users` tables and RLS policies
# Milestone: M1 (Auth + Tenant Model)
#
# Run in Git Bash (Windows) or any Unix shell, from the repo root.
# Prereqs: scaffold (#5) AND the Supabase infra (CLI + supabase/) are
#          already merged to main; Docker Desktop running.
# ============================================================

echo "==> 1/7  Sync main"
git checkout main
git pull --ff-only

echo "==> 2/7  Create the feature branch"
git checkout -b feature/m1-tenants-rls

echo "==> 3/7  Install deps (pulls Supabase CLI + everything)"
pnpm install

echo "==> 4/7  Generate an empty migration file"
pnpm supabase migration new create_tenants_and_users
echo "    -> created supabase/migrations/<timestamp>_create_tenants_and_users.sql"

cat <<'NEXT'

==> 5/7  EDIT that migration file. Paste this starter SQL and review every line:
-------------------------------------------------------------------------------
-- tenants
create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  plan_tier  text not null default 'free',
  is_active  boolean not null default true,
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- users (profile row linked to Supabase auth.users)
create table public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  email      text not null,
  role       text not null default 'user'
             check (role in ('admin','user','platform_admin')),
  created_at timestamptz not null default now()
);
create index on public.users(tenant_id);

-- turn ON row level security
alter table public.tenants enable row level security;
alter table public.users   enable row level security;

-- a user sees ONLY their own tenant row
create policy "tenants_select_own"
  on public.tenants for select to authenticated
  using ( id = (auth.jwt() ->> 'tenant_id')::uuid );

-- a user sees ONLY users inside their tenant
create policy "users_select_same_tenant"
  on public.users for select to authenticated
  using ( tenant_id = (auth.jwt() ->> 'tenant_id')::uuid );

-- NOTE: writes go through the server (service_role bypasses RLS), so no
-- client insert/update policies are needed yet. platform_admin "see all"
-- is a later refinement.
-------------------------------------------------------------------------------

==> 6/7  Apply + verify locally
    pnpm supabase start
    pnpm supabase db reset          # applies the migration to the local DB

    # Prove the isolation works (run in the Studio SQL editor from
    # `pnpm supabase status`): seed two tenants + a user in each, then:
    begin;
      set local role authenticated;
      set local request.jwt.claims = '{"tenant_id":"<TENANT_A_UUID>"}';
      select * from public.users;   -- expect: ONLY tenant A users
    rollback;
    -- repeat with TENANT_B and confirm you never see tenant A rows.

==> 7/7  Commit, push, open PR
    git add supabase/migrations
    git commit -m "feat(db): tenants + users tables with RLS

closes #2

Co-Authored-By: <partner name> <email>"
    git push -u origin feature/m1-tenants-rls
    gh pr create --base main \
      --title "feat(db): tenants + users tables with RLS" \
      --body "Closes #2. Adds tenants + users tables with tenant-scoped RLS select policies."

NEXT

echo "Branch + migration scaffold ready. Follow steps 5-7 above."
