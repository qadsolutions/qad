import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { TransactionSql } from "postgres";
import { bootstrapTestDatabase, seedTestData } from "../helpers/setup-test-db";

// Fixed UUIDs — stable across runs, easy to read in failure output.
const TENANT_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000000";
const USER_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000000";

// Single connection — prevents concurrent transactions from interfering
// with each other's SET LOCAL state.
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await bootstrapTestDatabase(sql);
  await seedTestData(sql, {
    tenantAId: TENANT_A_ID,
    tenantBId: TENANT_B_ID,
    userAId: USER_A_ID,
    userBId: USER_B_ID,
  });
}, 30_000); // 30 s — gives the CI postgres container time to finish cold-starting

afterAll(async () => {
  await sql.end();
});

/**
 * Run `query` as a simulated Supabase session for the given tenant/user.
 *
 * Replicates the two statements PostgREST issues before every API request:
 *   SET LOCAL ROLE authenticated
 *   SELECT set_config('request.jwt.claims', '{"tenant_id":"…"}', true)
 *
 * Both run inside a single transaction so LOCAL scoping works. After the
 * transaction commits, the role reverts to qad_user and the GUC is cleared.
 */
async function asUser<T>(
  tenantId: string,
  userId: string,
  query: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE authenticated`;
    const claims = JSON.stringify({
      tenant_id: tenantId,
      sub: userId,
      role: "authenticated",
    });
    await tx`SELECT set_config('request.jwt.claims', ${claims}, true)`;
    return query(tx);
  }) as Promise<T>;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

describe("cross-tenant row-level security", () => {
  describe("tenants table", () => {
    it("Tenant A user sees only Tenant A row", async () => {
      const rows = await asUser(TENANT_A_ID, USER_A_ID, (tx) =>
        tx<{ id: string }[]>`SELECT id FROM public.tenants`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(TENANT_A_ID);
    });

    it("Tenant B user sees only Tenant B row", async () => {
      const rows = await asUser(TENANT_B_ID, USER_B_ID, (tx) =>
        tx<{ id: string }[]>`SELECT id FROM public.tenants`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(TENANT_B_ID);
    });

    it("Tenant A user cannot read Tenant B row even with explicit id filter", async () => {
      const rows = await asUser(TENANT_A_ID, USER_A_ID, (tx) =>
        tx<{ id: string }[]>`
          SELECT id FROM public.tenants
          WHERE id = ${TENANT_B_ID}
        `,
      );

      // RLS USING clause is evaluated before the WHERE filter.
      // An explicit WHERE id = <other-tenant> still returns 0 rows.
      expect(rows).toHaveLength(0);
    });
  });

  describe("users table", () => {
    it("Tenant A user sees only their own user row", async () => {
      const rows = await asUser(TENANT_A_ID, USER_A_ID, (tx) =>
        tx<{ id: string; tenant_id: string }[]>`
          SELECT id, tenant_id FROM public.users
        `,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(USER_A_ID);
      expect(rows[0].tenant_id).toBe(TENANT_A_ID);
    });

    it("Tenant B user cannot read Tenant A user row even with explicit id filter", async () => {
      const rows = await asUser(TENANT_B_ID, USER_B_ID, (tx) =>
        tx<{ id: string }[]>`
          SELECT id FROM public.users
          WHERE id = ${USER_A_ID}
        `,
      );

      expect(rows).toHaveLength(0);
    });
  });
});
