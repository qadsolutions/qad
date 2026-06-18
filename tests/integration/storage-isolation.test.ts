import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { TransactionSql } from "postgres";
import { bootstrapTestDatabase, seedTestData } from "../helpers/setup-test-db";

/**
 * Cross-tenant isolation for the `documents` Storage bucket (#61).
 *
 * Same shape as the table-level isolation test, one layer down: it proves the
 * RLS policy on `storage.objects` confines an authenticated caller to objects
 * whose first path segment is their own tenant_id. The bucket layout is
 * `<tenant_id>/<document_id>/<filename>`, so the tenant folder is segment [1].
 *
 * The harness fakes a minimal `storage` schema (see setup-test-db.ts); the policy
 * under test is the real one from the migration.
 */

const TENANT_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000000";
const USER_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000000";

const OBJECT_A = `${TENANT_A_ID}/doc-a/contract.pdf`;
const OBJECT_B = `${TENANT_B_ID}/doc-b/pricing.pdf`;

// Single connection — keeps SET LOCAL state from leaking across transactions.
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

  // One object per tenant, written the way the server would (service_role / owner).
  await sql`
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES
      ('documents', ${OBJECT_A}, ${USER_A_ID}),
      ('documents', ${OBJECT_B}, ${USER_B_ID})
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

/**
 * Run `query` as a simulated Supabase session for the given claims — mirrors the
 * two statements PostgREST issues per request (SET LOCAL ROLE + jwt.claims GUC).
 * Omit `tenant_id` from the claims to simulate a token with no tenant_id.
 */
async function asClaims<T>(
  claims: Record<string, unknown>,
  query: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE authenticated`;
    await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    return query(tx);
  }) as Promise<T>;
}

const tenantClaims = (tenantId: string, userId: string) => ({
  tenant_id: tenantId,
  sub: userId,
  role: "authenticated",
});

describe("cross-tenant storage isolation (documents bucket)", () => {
  it("Tenant A sees only its own object", async () => {
    const rows = await asClaims(tenantClaims(TENANT_A_ID, USER_A_ID), (tx) =>
      tx<{ name: string }[]>`SELECT name FROM storage.objects WHERE bucket_id = 'documents'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(OBJECT_A);
  });

  it("Tenant B sees only its own object", async () => {
    const rows = await asClaims(tenantClaims(TENANT_B_ID, USER_B_ID), (tx) =>
      tx<{ name: string }[]>`SELECT name FROM storage.objects WHERE bucket_id = 'documents'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(OBJECT_B);
  });

  it("Tenant A cannot read Tenant B object even with an explicit name filter", async () => {
    const rows = await asClaims(tenantClaims(TENANT_A_ID, USER_A_ID), (tx) =>
      tx<{ name: string }[]>`
        SELECT name FROM storage.objects
        WHERE bucket_id = 'documents' AND name = ${OBJECT_B}
      `,
    );

    // The RLS USING clause is applied before WHERE, so the cross-tenant name
    // filter still returns nothing.
    expect(rows).toHaveLength(0);
  });

  it("a token with no tenant_id claim sees zero objects (fail-safe)", async () => {
    // e.g. a platform_admin token — no tenant_id claim. NULL on the policy's
    // right-hand side means the predicate is never true: zero rows.
    const rows = await asClaims({ sub: USER_A_ID, role: "authenticated" }, (tx) =>
      tx<{ name: string }[]>`SELECT name FROM storage.objects WHERE bucket_id = 'documents'`,
    );

    expect(rows).toHaveLength(0);
  });
});
