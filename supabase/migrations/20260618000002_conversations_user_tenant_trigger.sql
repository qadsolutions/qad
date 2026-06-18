-- M2 (#78): enforce conversations.tenant_id agrees with its user's tenant_id.
--
-- This is the THIRD and final tenant-consistency leg of #78. The first two
-- (document_chunks vs documents, messages vs conversations, in
-- 20260617000002_create_core_content_tables.sql) used composite FKs:
-- each parent got a `unique (id, tenant_id)`, and the child's FK targets that
-- pair so a mismatched tenant_id is a constraint violation rather than a latent
-- bug. conversations.tenant_id is likewise denormalized — here from the owning
-- user's tenant — but the same composite-FK trick does NOT work:
--
--   users.tenant_id is NULLABLE. Per #69
--   (20260617000001_nullable_tenant_id_platform_admin.sql) it is NULL exactly for
--   role = 'platform_admin' and NOT NULL otherwise. A composite FK from
--   conversations (user_id, tenant_id) -> users (id, tenant_id) would require a
--   `unique (id, tenant_id)` on users and could not express "the conversation's
--   non-NULL tenant_id must equal the user's tenant_id" when that user's tenant_id
--   side is NULL — FK matching treats a NULL component as "no match to check",
--   which would let a platform_admin-owned conversation carry an arbitrary
--   tenant_id. (Platform admins don't own client conversations anyway, so the
--   correct behaviour is to reject such a row outright.)
--
-- A BEFORE INSERT OR UPDATE trigger is the backstop instead. The reasoning is the
-- same DB-as-backstop-for-service_role-writes argument used throughout M2: ALL
-- writes go through service_role, which bypasses RLS, so a server-side bug is the
-- only thing standing between a mismatched row and a row invisible to its rightful
-- tenant. The DB constraint is the only layer that still fires for service_role.

create or replace function public.enforce_conversation_user_tenant()
returns trigger
language plpgsql
as $$
declare
  user_tenant_id uuid;
begin
  -- Look up the owning user's tenant. NULL here means the user is a platform_admin
  -- (users.tenant_id is NULL only for that role, per #69). conversations.tenant_id
  -- is NOT NULL, so a NULL user tenant is always a mismatch and must raise.
  select tenant_id into user_tenant_id
  from public.users
  where id = new.user_id;

  -- IS DISTINCT FROM, not <>, because one side can be NULL (platform_admin):
  -- (NULL <> x) is NULL (falsey, would let the row through), whereas
  -- (NULL IS DISTINCT FROM x) is TRUE — so the platform_admin case correctly raises.
  if user_tenant_id is distinct from new.tenant_id then
    raise exception
      'conversations.tenant_id (%) does not match users.tenant_id (%) for user_id %',
      new.tenant_id, user_tenant_id, new.user_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_conversation_user_tenant
  before insert or update on public.conversations
  for each row
  execute function public.enforce_conversation_user_tenant();
