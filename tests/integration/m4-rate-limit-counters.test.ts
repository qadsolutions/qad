import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { TransactionSql } from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";

/**
 * Integration tests for the M4 query rate-limit backing (#62),
 * 20260629000001_rate_limit_counters.sql:
 *
 *   rate_limit_counters  — (tenant_id, user_id, scope, window_start, count), PK on the
 *                          first four; tenant-scoped RLS SELECT; service_role writes.
 *   increment_rate_limit — atomic windowed counter: bumps the current aligned window's
 *                          count, self-prunes the subject's expired windows, returns
 *                          (current_count, reset_at).
 *
 * The window-refresh behaviour the issue's AC calls for lives in SQL now (not the TS
 * wrapper), so it is proven here against a real Postgres rather than with a fake clock.
 * The TS wrapper's allow/block/fail-open logic is covered in tests/unit/rate-limit.test.ts.
 */

const TENANT_A_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_B_ID = "22222222-2222-2222-2222-222222222222";
const USER_A_ID = "11111111-1111-1111-1111-000000000000";
const USER_B_ID = "22222222-2222-2222-2222-000000000000";

let sql: ReturnType<typeof postgres>;

/** Run `query` as a simulated Supabase session for the given tenant (PostgREST mirror). */
async function asUser<T>(
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
}

// The pg driver returns timestamptz as a Date (the production supabase-js/PostgREST path
// returns an ISO string instead — see database.types.ts — but this raw-SQL test sees a Date).
type IncrementRow = { current_count: number; reset_at: Date };

function increment(
  tenantId: string,
  userId: string,
  windowSeconds = 60,
  scope = "query",
): Promise<IncrementRow[]> {
  return sql<IncrementRow[]>`
    SELECT current_count, reset_at
    FROM public.increment_rate_limit(${tenantId}, ${userId}, ${scope}, ${windowSeconds})
  `;
}

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await bootstrapTestDatabase(sql);

  await sql`
    INSERT INTO auth.users (id, email) VALUES
      (${USER_A_ID}, 'usera@rl.test'),
      (${USER_B_ID}, 'userb@rl.test')
  `;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active) VALUES
      (${TENANT_A_ID}, 'Tenant A', 'rl-tenant-a', true),
      (${TENANT_B_ID}, 'Tenant B', 'rl-tenant-b', true)
  `;
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role) VALUES
      (${USER_A_ID}, ${TENANT_A_ID}, 'usera@rl.test', 'admin'),
      (${USER_B_ID}, ${TENANT_B_ID}, 'userb@rl.test', 'admin')
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

describe("increment_rate_limit", () => {
  it("increments within the same window and returns a stable reset_at", async () => {
    const first = (await increment(TENANT_A_ID, USER_A_ID))[0];
    const second = (await increment(TENANT_A_ID, USER_A_ID))[0];

    expect(first.current_count).toBe(1);
    expect(second.current_count).toBe(2); // same aligned 60s window -> same row
    // reset_at = window_start + 60s, identical for both calls in the window. Compare by
    // value (getTime), not object identity — the driver returns two distinct Date objects.
    expect(second.reset_at.getTime()).toBe(first.reset_at.getTime());
    expect(first.reset_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("keys each (tenant,user) independently", async () => {
    // USER_A already has a live counter from the test above; USER_B starts fresh.
    const b = (await increment(TENANT_B_ID, USER_B_ID))[0];
    expect(b.current_count).toBe(1);
  });

  it("starts a fresh count in a new window and prunes the expired one", async () => {
    // Disposable subject so this test is independent of the others' counters.
    const userId = "11111111-1111-1111-1111-00000000c001";
    await sql`INSERT INTO auth.users (id, email) VALUES (${userId}, 'rl-refresh@rl.test')`;
    await sql`
      INSERT INTO public.users (id, tenant_id, email, role)
      VALUES (${userId}, ${TENANT_A_ID}, 'rl-refresh@rl.test', 'user')
    `;

    // Seed a stale window (2 minutes ago) with a high count, as if last minute's traffic.
    await sql`
      INSERT INTO public.rate_limit_counters (tenant_id, user_id, scope, window_start, count)
      VALUES (${TENANT_A_ID}, ${userId}, 'query',
              to_timestamp(floor(extract(epoch FROM now()) / 60) * 60) - interval '2 minutes', 9)
    `;

    const row = (await increment(TENANT_A_ID, userId))[0];

    // The new window starts its own count at 1 — it does NOT continue from the stale 9.
    expect(row.current_count).toBe(1);

    // And the expired window row is pruned: only the current window remains for the subject.
    const remaining = await sql<{ window_start: string; count: number }[]>`
      SELECT window_start, count FROM public.rate_limit_counters
      WHERE tenant_id = ${TENANT_A_ID} AND user_id = ${userId} AND scope = 'query'
    `;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].count).toBe(1);
  });

  it("rejects a non-positive window", async () => {
    await expect(increment(TENANT_A_ID, USER_A_ID, 0)).rejects.toThrow(
      /p_window_seconds must be a positive integer/,
    );
  });
});

describe("rate_limit_counters constraints + RLS", () => {
  it("rejects a negative count (rate_limit_counters_nonnegative_count)", async () => {
    await expect(
      sql`
        INSERT INTO public.rate_limit_counters (tenant_id, user_id, scope, window_start, count)
        VALUES (${TENANT_A_ID}, ${USER_A_ID}, 'query', now(), -1)
      `,
    ).rejects.toThrow(/violates check constraint "rate_limit_counters_nonnegative_count"/);
  });

  it("RLS: Tenant A session sees zero of Tenant B's counters", async () => {
    // Both tenants have live counters from the increment tests above.
    const rows = await asUser(TENANT_A_ID, USER_A_ID, (tx) =>
      tx<{ tenant_id: string }[]>`SELECT tenant_id FROM public.rate_limit_counters`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === TENANT_A_ID)).toBe(true);
  });

  it("deleting a tenant cascades its counters away (ON DELETE CASCADE)", async () => {
    const dispTenantId = "33333333-3333-3333-3333-333333333333";
    const dispUserId = "33333333-3333-3333-3333-000000000000";
    await sql`INSERT INTO auth.users (id, email) VALUES (${dispUserId}, 'rl-casc@rl.test')`;
    await sql`
      INSERT INTO public.tenants (id, name, slug, is_active)
      VALUES (${dispTenantId}, 'Disposable', 'rl-tenant-disp', true)
    `;
    await sql`
      INSERT INTO public.users (id, tenant_id, email, role)
      VALUES (${dispUserId}, ${dispTenantId}, 'rl-casc@rl.test', 'admin')
    `;
    await increment(dispTenantId, dispUserId);

    await sql`DELETE FROM public.tenants WHERE id = ${dispTenantId}`;

    const rows = await sql`
      SELECT 1 FROM public.rate_limit_counters WHERE tenant_id = ${dispTenantId}
    `;
    expect(rows).toHaveLength(0);
  });
});
