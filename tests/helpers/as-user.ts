import type { Sql, TransactionSql } from "postgres";

/**
 * Build an asUser() helper bound to `sql`: runs `query` as a simulated Supabase
 * authenticated session for the given tenant/user — replicating the two
 * statements PostgREST issues before every API request (SET LOCAL ROLE
 * authenticated + set request.jwt.claims), both inside one transaction so
 * LOCAL scoping works. Pattern originates from
 * tests/integration/tenant-isolation.test.ts (the protected M1 gate), which
 * keeps its own inline copy deliberately rather than importing this — see
 * CLAUDE.md on that file's protected-CI-gate status.
 */
export function createAsUser(sql: Sql) {
  return async function asUser<T>(
    tenantId: string,
    userId: string,
    query: (tx: TransactionSql) => Promise<T>,
  ): Promise<T> {
    return sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE authenticated`;
      const claims = JSON.stringify({ tenant_id: tenantId, sub: userId, role: "authenticated" });
      await tx`SELECT set_config('request.jwt.claims', ${claims}, true)`;
      return query(tx);
    }) as Promise<T>;
  };
}
