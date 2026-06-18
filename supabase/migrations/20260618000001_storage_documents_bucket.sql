-- M2 (#61): private Storage bucket for raw document files, tenant-scoped.
--
-- Real Supabase manages storage.buckets / storage.objects; this migration only
-- registers our bucket and attaches RLS policies (the same way any Supabase
-- project adds storage policies via SQL). The test harness fakes a minimal
-- `storage` schema so these statements apply and the policy is exercised.
--
-- PATH CONVENTION (load-bearing): every object is stored as
--     <tenant_id>/<document_id>/<filename>
-- so the FIRST path segment is the owning tenant. The policy keys off exactly
-- that segment, so isolation holds for any deeper layout beneath it.

-- Private bucket — no public/anonymous access. Every download is authorized.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- storage.objects already exists (Supabase-managed); ensure RLS is on. Idempotent.
alter table storage.objects enable row level security;

-- authenticated may READ only objects under their own tenant's top-level folder.
-- Three-valued logic makes this fail safe: a token with no tenant_id claim yields
-- NULL on the right-hand side, the predicate is never true, and zero rows are
-- visible. So a platform_admin (no tenant_id claim) sees nothing through the anon
-- client — cross-tenant object access is service_role-only, like every other table.
create policy "documents: tenant read own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
  );

-- No INSERT/UPDATE/DELETE policies for authenticated: clients never write to
-- storage directly. The upload pipeline (#23) writes as service_role, which
-- bypasses RLS. anon receives nothing (no policy, no grant).
