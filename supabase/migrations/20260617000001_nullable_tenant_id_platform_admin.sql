-- M2 (#69): platform_admin belongs to no tenant.
--
-- The operator role (`platform_admin`) is not a client of any tenant. Represent
-- that truthfully in the schema: make `users.tenant_id` nullable, but ONLY for
-- platform admins. Two complementary CHECKs make the nullability exclusive so that
--
--     tenant_id IS NULL  <=>  role = 'platform_admin'
--
-- This fails safe (a NULL tenant_id matches no RLS policy, so a platform admin reads
-- zero client rows through the normal anon-key client) and closes the confused-deputy
-- path where a platform_admin row carries a tenant_id and is treated as a client of
-- that tenant. Cross-tenant access is only ever via `service_role` behind the separate
-- `withPlatformAdmin` guard. See SECURITY.md §3.4.

-- ---------------------------------------------------------------------------
-- Make tenant_id optional. The FK to public.tenants is unaffected (a FK permits
-- NULL); only the NOT NULL constraint is dropped.
-- ---------------------------------------------------------------------------

alter table public.users
  alter column tenant_id drop not null;

-- ---------------------------------------------------------------------------
-- Two complementary guards. Kept as separate, named constraints (rather than one
-- combined predicate) so a violation names exactly which half failed.
-- ---------------------------------------------------------------------------

-- Clients (`user` / `admin`) must have a tenant.
alter table public.users
  add constraint users_client_requires_tenant
  check (role = 'platform_admin' or tenant_id is not null);

-- Platform admins must NOT carry a tenant.
alter table public.users
  add constraint users_platform_admin_has_no_tenant
  check (role <> 'platform_admin' or tenant_id is null);

-- ---------------------------------------------------------------------------
-- Bootstrap (SECURITY.md §3.4): the FIRST platform_admin is a chicken-and-egg case
-- (no platform admin exists yet to authorize a withPlatformAdmin route), so it is
-- seeded by DIRECT DATABASE ACCESS only. No signup/invite flow may ever produce this
-- role; user-facing endpoints (anon-key client) allow-list 'user'/'admin' only.
--
-- Example (run server-side / SQL console, after creating the auth user via the
-- Supabase Admin API so public.users.id references auth.users.id):
--
--   insert into public.users (id, tenant_id, email, role)
--   values ('<auth-user-uuid>', null, 'ops@qadsolutions.example', 'platform_admin');
--
-- The custom_access_token_hook already stamps `tenant_id` only when non-null
-- (20260616000001), so a tenant-less platform_admin token simply omits the claim —
-- no hook change is required.
