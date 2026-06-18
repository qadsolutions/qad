import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql } from "postgres";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

// Migrations are auto-discovered from MIGRATIONS_DIR and applied in chronological
// (filename) order — the same order Supabase applies them in production. New
// migrations are picked up automatically; there is no list to maintain, so the
// test DB can never silently drift from the real schema (which previously produced
// false-green isolation runs against a stale schema).
//
// MIGRATION_DENYLIST is for the rare migration that genuinely cannot run in this
// lightweight harness. Keep it EMPTY where possible — every entry is a gap in what
// the test DB verifies — and give each one a reason. It is currently empty: the
// service_role grant migration applies because bootstrapTestDatabase creates the
// service_role role below.
const MIGRATION_DENYLIST = new Set<string>();

/** Migration filenames must be timestamp-prefixed so filename sort = apply order. */
const MIGRATION_FILENAME = /^\d{14}_.+\.sql$/;

/** All on-disk migrations in chronological order, minus the denylist. */
function migrationsToApply(): string[] {
  const files = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith(".sql") && !MIGRATION_DENYLIST.has(f),
  );
  // Apply order is filename order, which only equals chronological order while
  // every name is <14-digit timestamp>_<slug>.sql. A stray name (e.g. V2__x.sql)
  // would sort into the wrong place and silently apply out of order — fail loudly.
  const malformed = files.filter((f) => !MIGRATION_FILENAME.test(f));
  if (malformed.length > 0) {
    throw new Error(
      "Migration filenames must match <14-digit timestamp>_<name>.sql so filename " +
        `sort equals apply order. Offenders: ${malformed.join(", ")}`,
    );
  }
  return files.sort();
}

/**
 * Build the Supabase compatibility layer and apply all migrations.
 *
 * Safe to call repeatedly — drops and rebuilds the public and auth schemas
 * each time so local re-runs stay idempotent.
 *
 * Must run as a superuser (qad_user in CI). In production Supabase manages
 * all of this; this function only exists to make the test DB match Supabase's
 * environment closely enough that RLS behaves identically.
 */
export async function bootstrapTestDatabase(sql: Sql): Promise<void> {
  // 1. Clean slate — drop and recreate both schemas so re-runs are idempotent.
  //    CASCADE drops all tables, functions, indexes, and policies inside.
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO CURRENT_USER;
    GRANT USAGE ON SCHEMA public TO PUBLIC;

    DROP SCHEMA IF EXISTS auth CASCADE;
    CREATE SCHEMA auth;
  `);

  // 2. Create the three roles that our migrations reference.
  //    IF NOT EXISTS avoids errors when the CI container already has them.
  await sql.unsafe(`
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE anon;           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE supabase_auth_admin NOINHERIT;
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    -- service_role: the server-side write path that bypasses RLS in production.
    -- Created so the service_role grant migration applies and service_role writes
    -- are exercised by tests (fidelity with production).
    DO $$ BEGIN CREATE ROLE service_role NOINHERIT BYPASSRLS;
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  // 3. auth.users — FK target for public.users.
  //    Supabase manages this table in production (it lives inside GoTrue).
  //    We create a minimal version so the FK in migration 1 resolves.
  await sql.unsafe(`
    CREATE TABLE auth.users (
      id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text
    );
  `);

  // 4. auth.jwt() — reads request.jwt.claims GUC that PostgREST sets per-request.
  //    Identical to Supabase's built-in. STABLE: may be cached across rows within
  //    a single statement — safe here because the JWT does not change mid-query.
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE AS $$
      SELECT COALESCE(
        NULLIF(CURRENT_SETTING('request.jwt.claims', TRUE), ''),
        '{}'
      )::jsonb
    $$;
  `);

  // 5. Grant authenticated role the access it needs to call auth.jwt() from
  //    within RLS policy USING expressions.
  //    Without USAGE on schema auth: "permission denied for schema auth"
  //    Without EXECUTE on auth.jwt(): "permission denied for function jwt"
  await sql.unsafe(`
    GRANT USAGE  ON SCHEMA auth              TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.jwt()     TO authenticated;
  `);

  // 5b. Minimal mirror of Supabase Storage. Real Supabase manages the `storage`
  //     schema; we fake the subset our policies use (buckets, objects,
  //     foldername()) so the storage migration (#61) applies and its RLS can be
  //     tested the same way the auth schema above lets us test table RLS.
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS storage CASCADE;
    CREATE SCHEMA storage;

    CREATE TABLE storage.buckets (
      id     text PRIMARY KEY,
      name   text NOT NULL,
      public boolean NOT NULL DEFAULT false
    );

    CREATE TABLE storage.objects (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id  text REFERENCES storage.buckets (id),
      name       text NOT NULL,
      owner      uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- Faithful mirror of Supabase's helper: split on '/' and DROP the trailing
    -- filename segment. So foldername('a/b/file.pdf') => {a,b}, foldername('a/x') =>
    -- {a}, and a single-segment name with no '/' => {} (whose [1] is NULL, so the
    -- policy fails closed) — exactly like production. Keeping the filename (an
    -- earlier shortcut) made a slash-less object visible here but hidden in prod.
    -- IMMUTABLE is correct (string_to_array on a literal delimiter is pure); real
    -- Supabase marks it STABLE, but the result is identical.
    CREATE OR REPLACE FUNCTION storage.foldername(name text)
    RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
      SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
    $$;

    GRANT USAGE ON SCHEMA storage TO authenticated, service_role;
    GRANT SELECT ON storage.objects, storage.buckets TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets TO service_role;
  `);

  // 6. Apply every migration on disk in filename (chronological) order.
  //    sql.unsafe() is required for DDL — the postgres package disables
  //    parameterization for raw strings, which is correct for migration files.
  for (const filename of migrationsToApply()) {
    const migrationSql = readFileSync(resolve(MIGRATIONS_DIR, filename), "utf-8");
    await sql.unsafe(migrationSql);
  }
}

export interface SeedOptions {
  tenantAId: string;
  tenantBId: string;
  userAId: string;
  userBId: string;
}

/**
 * Insert two tenants and two users (one per tenant).
 *
 * Runs as qad_user (superuser) so RLS does not filter the inserts.
 * ON CONFLICT DO NOTHING makes this safe to call after a non-clean bootstrap,
 * but in practice the schema reset in bootstrapTestDatabase means there are
 * never existing rows to conflict with.
 */
export async function seedTestData(sql: Sql, opts: SeedOptions): Promise<void> {
  const { tenantAId, tenantBId, userAId, userBId } = opts;

  // auth.users must be seeded first — public.users has a FK to auth.users.
  await sql`
    INSERT INTO auth.users (id, email) VALUES
      (${userAId}, 'usera@tenant-a.test'),
      (${userBId}, 'userb@tenant-b.test')
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active) VALUES
      (${tenantAId}, 'Tenant A', 'tenant-a', true),
      (${tenantBId}, 'Tenant B', 'tenant-b', true)
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO public.users (id, tenant_id, email, role) VALUES
      (${userAId}, ${tenantAId}, 'usera@tenant-a.test', 'admin'),
      (${userBId}, ${tenantBId}, 'userb@tenant-b.test', 'admin')
    ON CONFLICT (id) DO NOTHING
  `;
}
