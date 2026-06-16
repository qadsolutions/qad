# Issue #2 — Framework: `tenants` + `users` tables and RLS

A direction-setting brief, not a solution. You design and write the SQL — this
just describes *what* it needs to do and *how to know it's correct*.

Milestone: **M1 (Auth + Tenant Model)**.

---

## Goal

Create the two foundational tables for tenant isolation, and use Row Level
Security so a logged-in user can only ever read data belonging to **their own
tenant**. Everything else in M1 (auth, middleware, the isolation test) builds on
this.

## What you're building

Two tables, in a single migration under `supabase/migrations/`.

**`tenants`** — one row per client business. It should capture, at minimum:
- a primary key, the tenant's `name`, a URL-safe `slug`
- a `plan_tier`, an `is_active` flag, a JSONB `settings` blob, a created timestamp

**`users`** — one profile row per person, linked to Supabase Auth:
- a primary key that ties back to Supabase's `auth.users`
- a `tenant_id` foreign key to `tenants`
- `email` and a `role` constrained to `admin` / `user` / `platform_admin`
- a created timestamp

(These fields come straight from the issue's acceptance criteria — treat them as
the spec. The exact column types, constraints, and DDL are yours to write.)

## The core requirement — tenant isolation via RLS

This is the actual point of the issue:

- **Enable RLS** on both tables.
- Add **SELECT policies** whose rule is, in plain English: *a user may read a row
  only if its tenant matches the `tenant_id` in their JWT.* The tenant identity
  must come from the **verified JWT claim** (`auth.jwt()`), never from anything the
  client sends in a request body or query param.
- **Writes** are done server-side with the service_role key (which bypasses RLS),
  so you do **not** need client-facing insert/update policies yet.

> The JWT won't actually carry a `tenant_id` claim until issue #1 wires up the
> Auth hook. That's fine — your policies are written against that claim now, and
> #4 proves them end-to-end once #1 lands. For #2, you verify locally by faking
> the claim (see below).

## How to verify it (your definition of done)

1. Apply locally: `pnpm supabase db reset` should run your migration with no errors.
2. Seed two tenants (A and B) and a user in each.
3. Simulate a logged-in user for Tenant A and confirm a `select` on `users`
   returns **only Tenant A's rows** — zero of Tenant B's. Repeat for B.
   - Locally you can fake the JWT claim inside a transaction using Postgres'
     `request.jwt.claims` setting — look up how `auth.jwt()` reads it.

Done when:
- both tables exist with RLS enabled and the select policies in place,
- the migration is committed under `supabase/migrations/`,
- the local cross-tenant check returns zero leaked rows,
- `pnpm tsc --noEmit` still passes.

## The dev loop

```
git checkout main && git pull
git checkout -b feature/m1-tenants-rls
pnpm supabase migration new create_tenants_and_users   # write your SQL here
pnpm supabase db reset                                  # test locally
git commit -m "feat(db): tenants + users tables with RLS (closes #2)"
git push -u origin feature/m1-tenants-rls
gh pr create --base main          # wait for green CI, then merge
```

## Reference

- Setup + migration commands: `docs/SUPABASE_SETUP.md`
- Schema + security rules: `CLAUDE.md` (Database Schema, Security Rules)
- Acceptance criteria: GitHub issue #2
