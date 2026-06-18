import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";

/**
 * Integration tests for the two CHECK constraints added in #69
 * (20260617000001_nullable_tenant_id_platform_admin.sql):
 *
 *   users_client_requires_tenant       — role <> platform_admin ⇒ tenant_id NOT NULL
 *   users_platform_admin_has_no_tenant — role  = platform_admin ⇒ tenant_id IS NULL
 *
 * Together they enforce  tenant_id IS NULL  ⟺  role = 'platform_admin'.
 *
 * These run as the table owner (qad_user), so RLS does not interfere — the point
 * is to prove the DB layer itself refuses violating rows. Without this, a typo in
 * the migration could silently drop the confused-deputy guarantee and every other
 * layer (hook, withTenant) would still look green.
 */

const TENANT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// One auth.users row per insert we attempt (public.users.id FKs to auth.users.id).
const AU = {
  adminValid: "10000000-0000-0000-0000-000000000001",
  adminNull: "10000000-0000-0000-0000-000000000002",
  userNull: "10000000-0000-0000-0000-000000000003",
  paWithTenant: "10000000-0000-0000-0000-000000000004",
  paNull: "10000000-0000-0000-0000-000000000005",
};

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await bootstrapTestDatabase(sql);

  // FK targets: an auth.users row per case, plus a tenant for the with-tenant cases.
  await sql`
    INSERT INTO auth.users (id, email) VALUES
      (${AU.adminValid},   'admin-valid@check.test'),
      (${AU.adminNull},    'admin-null@check.test'),
      (${AU.userNull},     'user-null@check.test'),
      (${AU.paWithTenant}, 'pa-tenant@check.test'),
      (${AU.paNull},       'pa-null@check.test')
  `;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active)
    VALUES (${TENANT_ID}, 'Tenant C', 'tenant-c', true)
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

describe("users tenant_id CHECK constraints (#69)", () => {
  // ---- Rows that MUST be accepted -----------------------------------------

  it("accepts an admin WITH a tenant_id", async () => {
    // RETURNING the full triple confirms the row was written AND persisted with the
    // intended values — a row landing with the wrong tenant_id or role would fail
    // here, not slip through on a bare id check.
    const rows = await sql<{ id: string; tenant_id: string | null; role: string }[]>`
      INSERT INTO public.users (id, tenant_id, email, role)
      VALUES (${AU.adminValid}, ${TENANT_ID}, 'admin-valid@check.test', 'admin')
      RETURNING id, tenant_id, role
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: AU.adminValid, tenant_id: TENANT_ID, role: "admin" });
  });

  it("accepts a platform_admin with NULL tenant_id", async () => {
    const rows = await sql<{ id: string; tenant_id: string | null; role: string }[]>`
      INSERT INTO public.users (id, tenant_id, email, role)
      VALUES (${AU.paNull}, ${null}, 'pa-null@check.test', 'platform_admin')
      RETURNING id, tenant_id, role
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: AU.paNull, tenant_id: null, role: "platform_admin" });
  });

  // ---- Rows that MUST be rejected ------------------------------------------

  it("rejects an admin with NULL tenant_id (users_client_requires_tenant)", async () => {
    await expect(
      sql`
        INSERT INTO public.users (id, tenant_id, email, role)
        VALUES (${AU.adminNull}, ${null}, 'admin-null@check.test', 'admin')
      `,
    ).rejects.toThrow(/violates check constraint "users_client_requires_tenant"/);
  });

  it("rejects a user with NULL tenant_id (users_client_requires_tenant)", async () => {
    await expect(
      sql`
        INSERT INTO public.users (id, tenant_id, email, role)
        VALUES (${AU.userNull}, ${null}, 'user-null@check.test', 'user')
      `,
    ).rejects.toThrow(/violates check constraint "users_client_requires_tenant"/);
  });

  it("rejects a platform_admin that carries a tenant_id — confused-deputy (users_platform_admin_has_no_tenant)", async () => {
    await expect(
      sql`
        INSERT INTO public.users (id, tenant_id, email, role)
        VALUES (${AU.paWithTenant}, ${TENANT_ID}, 'pa-tenant@check.test', 'platform_admin')
      `,
    ).rejects.toThrow(/violates check constraint "users_platform_admin_has_no_tenant"/);
  });
});
