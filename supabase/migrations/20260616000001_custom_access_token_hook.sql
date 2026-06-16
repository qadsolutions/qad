-- M1: custom access token hook — inject tenant_id (+ user_role) into every JWT.
--
-- This is the foundation of tenant isolation: every issued access token carries
-- the user's tenant_id claim, read on the server from the JWT only (SECURITY.md §3).
-- The hook runs inside GoTrue as the `supabase_auth_admin` role before a token is
-- issued. It looks up the user's tenant_id/role from public.users and merges them
-- into the token claims.
--
-- Enabled via supabase/config.toml: [auth.hook.custom_access_token].

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims      jsonb;
  v_tenant_id uuid;
  v_role      text;
begin
  select u.tenant_id, u.role
    into v_tenant_id, v_role
  from public.users u
  where u.id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  -- tenant_id is the isolation key. Stamp it whenever the user has a tenant.
  if v_tenant_id is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id::text));
  end if;

  -- Application role. Named user_role to avoid clobbering the reserved `role`
  -- claim (the Postgres role that drives RLS).
  if v_role is not null then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: only supabase_auth_admin (the role GoTrue runs hooks as) may execute
-- the hook and read the table it depends on. No other role gets access.
-- ---------------------------------------------------------------------------

grant usage on schema public to supabase_auth_admin;

grant execute
  on function public.custom_access_token_hook(jsonb)
  to supabase_auth_admin;

revoke execute
  on function public.custom_access_token_hook(jsonb)
  from authenticated, anon, public;

-- The hook reads public.users, which has RLS enabled. Grant the auth admin role
-- SELECT plus a permissive read policy scoped to that role only, so the hook can
-- resolve tenant_id during token issuance without weakening tenant isolation for
-- normal users.
grant select on table public.users to supabase_auth_admin;

create policy "auth_admin reads users for jwt hook"
  on public.users
  for select
  to supabase_auth_admin
  using (true);
