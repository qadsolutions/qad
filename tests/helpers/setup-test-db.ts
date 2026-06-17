import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql } from "postgres";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

// Applied in chronological order. The service_role grant migration
// (20260616000002) is intentionally omitted — the test DB has no `service_role`
// role and the isolation test exercises the RLS (anon-key) path, not service_role.
// NOTE: new schema migrations must be added here so the test DB matches production.
const MIGRATIONS_IN_ORDER = [
  "20260615000001_create_tenants_and_users.sql",
  "20260616000001_custom_access_token_hook.sql",
  "20260617000001_nullable_tenant_id_platform_admin.sql",
];

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
  //    Identical to Supabase's built-in. STABLE so PostgreSQL can cache within
  //    a query but must re-evaluate per row (correct for RLS).
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

  // 6. Apply migrations in filename (chronological) order.
  //    sql.unsafe() is required for DDL — the postgres package disables
  //    parameterization for raw strings, which is correct for migration files.
  for (const filename of MIGRATIONS_IN_ORDER) {
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
