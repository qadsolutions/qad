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

-- Private bucket — no public/anonymous access. DO UPDATE (not DO NOTHING) so that
-- if a `documents` bucket already exists (e.g. created by hand in the dashboard),
-- this re-asserts `public = false`. A public bucket would be readable anonymously
-- via the CDN URL, bypassing the RLS policy below entirely — so privacy must be
-- enforced here, not merely assumed.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;

-- storage.objects already exists (Supabase-managed); ensure RLS is on. Idempotent.
alter table storage.objects enable row level security;

-- authenticated may READ only objects under their own tenant's top-level folder.
-- The JWT claim is cast to uuid (then back to text, since the path segment is
-- text) to match the ::uuid discipline of the table policies and to fail closed on
-- a malformed claim. Three-valued logic also makes the absent-claim case fail safe:
-- a token with no tenant_id yields NULL on the right-hand side, the predicate is
-- never true, and zero rows are visible. So a platform_admin (no tenant_id claim)
-- sees nothing through the anon client — cross-tenant object access is
-- service_role-only, consistent with every table.
drop policy if exists "documents: tenant read own" on storage.objects;
create policy "documents: tenant read own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')::uuid::text
  );

-- No INSERT/UPDATE/DELETE policies for authenticated: by design, clients never
-- write to storage directly. The server-side ingestion path writes as
-- service_role, which bypasses RLS. anon receives nothing (no policy, no grant).
