-- M1 fix: grant service_role table privileges on the M1 tables.
--
-- service_role is the documented server-side write path (document ingestion,
-- platform-admin operations, test seeding) and bypasses RLS. But the original
-- table migration (20260615000001) granted table-level privileges only to
-- `authenticated`. Without explicit grants, server-side writes as service_role
-- fail with "permission denied for table ..." (SQLSTATE 42501) — RLS bypass does
-- not imply table privileges.
--
-- anon intentionally receives nothing (no policies, no grants). authenticated
-- keeps its RLS-scoped SELECT from the original migration.

grant select, insert, update, delete on public.tenants to service_role;
grant select, insert, update, delete on public.users   to service_role;
