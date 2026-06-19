import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { TransactionSql } from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";

/**
 * Integration tests for the M2 operational tables (#21),
 * 20260618000004_operational_tables.sql:
 *
 *   retrieval_logs — id, message_id, tenant_id, chunk_ids[], similarity_scores[]
 *   model_calls    — id, tenant_id, user_id, model_name, *_tokens, latency_ms
 *   audit_logs     — id, tenant_id (NULLABLE), user_id, action, resource_type,
 *                    resource_id, ip_address
 *   settings       — id, tenant_id, key, value (jsonb), updated_by, UNIQUE(tenant_id, key)
 *
 * Authoritative shape comes from CLAUDE.md "Database Schema" + SECURITY.md §5
 * (which are more detailed than issue #21's abbreviated AC list). In particular
 * audit_logs.tenant_id is nullable (Option A, 2026-06-17) and user_id is NOT NULL.
 *
 * Two flavours of test here:
 *   - Owner-context inserts/constraints run as qad_user (table owner), so RLS does
 *     not interfere — they prove the DB layer itself accepts/rejects the right rows.
 *   - RLS filtering tests use asUser() to replicate the two statements PostgREST
 *     issues per request (SET LOCAL ROLE authenticated + set the jwt claims GUC),
 *     mirroring tests/integration/tenant-isolation.test.ts.
 *
 * Out of scope per issue #21 Notes (deferred to M9): the audit-log UPDATE/DELETE
 * restriction (the immutability *trigger*) and the "NULL tenant_id ⇒ actor is
 * platform_admin" write-path invariant. We only verify tenant_id is genuinely
 * nullable.
 *
 * In scope here (review feedback on #81): the FK ON DELETE actions that protect
 * the audit trail and usage history from cascade-deletion —
 *   - audit_logs.user_id   ON DELETE RESTRICT  (SECURITY.md §5: actor never lost)
 *   - audit_logs.tenant_id  ON DELETE SET NULL (compliance row survives a tenant delete)
 *   - model_calls.user_id   ON DELETE SET NULL (usage row survives a user delete)
 * plus the CHECK constraints (retrieval_logs parallel-array cardinality match,
 * model_calls non-negative counts).
 */

const TENANT_A_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_B_ID = "22222222-2222-2222-2222-222222222222";
const USER_A_ID = "11111111-1111-1111-1111-000000000000";
const USER_B_ID = "22222222-2222-2222-2222-000000000000";
const PLATFORM_ADMIN_ID = "99999999-9999-9999-9999-000000000000";

// Conversation + message per tenant — retrieval_logs.message_id FKs to messages.
const CONVERSATION_A_ID = "11111111-1111-1111-1111-0000000000c0";
const CONVERSATION_B_ID = "22222222-2222-2222-2222-0000000000c0";
const MESSAGE_A_ID = "11111111-1111-1111-1111-0000000000a0";
const MESSAGE_B_ID = "22222222-2222-2222-2222-0000000000a0";

const CHUNK_ID_1 = "11111111-1111-1111-1111-0000000000d1";
const CHUNK_ID_2 = "11111111-1111-1111-1111-0000000000d2";

let sql: ReturnType<typeof postgres>;

/**
 * Run `query` as a simulated Supabase session for the given tenant.
 * Mirrors tests/integration/tenant-isolation.test.ts.
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

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await bootstrapTestDatabase(sql);

  // FK targets: auth.users rows, two tenants + their users, a platform_admin,
  // and one conversation + message per tenant for retrieval_logs.message_id.
  await sql`
    INSERT INTO auth.users (id, email) VALUES
      (${USER_A_ID},         'usera@op.test'),
      (${USER_B_ID},         'userb@op.test'),
      (${PLATFORM_ADMIN_ID}, 'pa@op.test')
  `;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active) VALUES
      (${TENANT_A_ID}, 'Tenant A', 'op-tenant-a', true),
      (${TENANT_B_ID}, 'Tenant B', 'op-tenant-b', true)
  `;
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role) VALUES
      (${USER_A_ID}, ${TENANT_A_ID}, 'usera@op.test', 'admin'),
      (${USER_B_ID}, ${TENANT_B_ID}, 'userb@op.test', 'admin')
  `;
  // platform_admin has no tenant (users.tenant_id nullable only for this role, #69).
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role)
    VALUES (${PLATFORM_ADMIN_ID}, ${null}, 'pa@op.test', 'platform_admin')
  `;
  await sql`
    INSERT INTO public.conversations (id, user_id, tenant_id) VALUES
      (${CONVERSATION_A_ID}, ${USER_A_ID}, ${TENANT_A_ID}),
      (${CONVERSATION_B_ID}, ${USER_B_ID}, ${TENANT_B_ID})
  `;
  await sql`
    INSERT INTO public.messages (id, conversation_id, tenant_id, role, content) VALUES
      (${MESSAGE_A_ID}, ${CONVERSATION_A_ID}, ${TENANT_A_ID}, 'assistant', 'answer a'),
      (${MESSAGE_B_ID}, ${CONVERSATION_B_ID}, ${TENANT_B_ID}, 'assistant', 'answer b')
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

// ---------------------------------------------------------------------------
// retrieval_logs
// ---------------------------------------------------------------------------

describe("retrieval_logs", () => {
  it("accepts a valid insert and round-trips its columns", async () => {
    const rows = await sql<
      {
        message_id: string;
        tenant_id: string;
        chunk_ids: string[];
        similarity_scores: number[];
      }[]
    >`
      INSERT INTO public.retrieval_logs
        (message_id, tenant_id, chunk_ids, similarity_scores)
      VALUES
        (${MESSAGE_A_ID}, ${TENANT_A_ID},
         ${sql.array([CHUNK_ID_1, CHUNK_ID_2])}::uuid[],
         ${sql.array([0.91, 0.82])}::double precision[])
      RETURNING message_id, tenant_id, chunk_ids, similarity_scores
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      message_id: MESSAGE_A_ID,
      tenant_id: TENANT_A_ID,
    });
    expect(rows[0].chunk_ids).toEqual([CHUNK_ID_1, CHUNK_ID_2]);
    expect(rows[0].similarity_scores).toEqual([0.91, 0.82]);
  });

  it("rejects a row whose tenant_id disagrees with its message's tenant_id (composite FK)", async () => {
    // MESSAGE_A_ID belongs to TENANT_A; claiming TENANT_B is the cross-tenant
    // mismatch a buggy service_role write could otherwise produce.
    await expect(
      sql`
        INSERT INTO public.retrieval_logs
          (message_id, tenant_id, chunk_ids, similarity_scores)
        VALUES
          (${MESSAGE_A_ID}, ${TENANT_B_ID}, ${sql.array([CHUNK_ID_1])}::uuid[], ${sql.array([0.5])}::double precision[])
      `,
    ).rejects.toThrow(/violates foreign key constraint "retrieval_logs_msg_tenant_fk"/);
  });

  it("rejects mismatched parallel-array lengths (retrieval_logs_arrays_same_length)", async () => {
    // Two chunk_ids but only one similarity_score — the i-th score no longer pairs
    // with the i-th chunk. The CHECK must reject this before it can misalign scores.
    await expect(
      sql`
        INSERT INTO public.retrieval_logs
          (message_id, tenant_id, chunk_ids, similarity_scores)
        VALUES
          (${MESSAGE_A_ID}, ${TENANT_A_ID},
           ${sql.array([CHUNK_ID_1, CHUNK_ID_2])}::uuid[],
           ${sql.array([0.91])}::double precision[])
      `,
    ).rejects.toThrow(/violates check constraint "retrieval_logs_arrays_same_length"/);
  });

  it("RLS: Tenant A session sees zero of Tenant B's retrieval_logs", async () => {
    // Seed one row for each tenant (as owner, bypassing RLS).
    await sql`
      INSERT INTO public.retrieval_logs (message_id, tenant_id, chunk_ids, similarity_scores)
      VALUES (${MESSAGE_B_ID}, ${TENANT_B_ID}, ${sql.array([CHUNK_ID_1])}::uuid[], ${sql.array([0.7])}::double precision[])
    `;
    const rows = await asUser(TENANT_A_ID, USER_A_ID, (tx) =>
      tx<{ tenant_id: string }[]>`SELECT tenant_id FROM public.retrieval_logs`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === TENANT_A_ID)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// model_calls
// ---------------------------------------------------------------------------

describe("model_calls", () => {
  it("accepts a valid insert and round-trips its columns", async () => {
    const rows = await sql<
      {
        tenant_id: string;
        user_id: string;
        model_name: string;
        prompt_tokens: number;
        completion_tokens: number;
        latency_ms: number;
      }[]
    >`
      INSERT INTO public.model_calls
        (tenant_id, user_id, model_name, prompt_tokens, completion_tokens, latency_ms)
      VALUES
        (${TENANT_A_ID}, ${USER_A_ID}, 'llama3.3-70b', 1200, 350, 842)
      RETURNING tenant_id, user_id, model_name, prompt_tokens, completion_tokens, latency_ms
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT_A_ID,
      user_id: USER_A_ID,
      model_name: "llama3.3-70b",
      prompt_tokens: 1200,
      completion_tokens: 350,
      latency_ms: 842,
    });
  });

  it("rejects negative token/latency counts (model_calls_nonnegative_counts)", async () => {
    await expect(
      sql`
        INSERT INTO public.model_calls
          (tenant_id, user_id, model_name, prompt_tokens, completion_tokens, latency_ms)
        VALUES (${TENANT_A_ID}, ${USER_A_ID}, 'llama3.3-70b', -1, 5, 100)
      `,
    ).rejects.toThrow(/violates check constraint "model_calls_nonnegative_counts"/);
  });

  it("RLS: Tenant A session sees zero of Tenant B's model_calls", async () => {
    await sql`
      INSERT INTO public.model_calls
        (tenant_id, user_id, model_name, prompt_tokens, completion_tokens, latency_ms)
      VALUES (${TENANT_B_ID}, ${USER_B_ID}, 'llama3.3-70b', 10, 5, 100)
    `;
    const rows = await asUser(TENANT_A_ID, USER_A_ID, (tx) =>
      tx<{ tenant_id: string }[]>`SELECT tenant_id FROM public.model_calls`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === TENANT_A_ID)).toBe(true);
  });

  it("deleting a user preserves their model_calls row with user_id set to NULL (ON DELETE SET NULL)", async () => {
    // Disposable user scoped to this test — must NOT touch the shared USER_A/USER_B
    // fixtures other tests depend on. Belongs to TENANT_A so RLS/FK shape is realistic.
    const disposableUserId = "11111111-1111-1111-1111-00000000de01";
    await sql`INSERT INTO auth.users (id, email) VALUES (${disposableUserId}, 'mc-del@op.test')`;
    await sql`
      INSERT INTO public.users (id, tenant_id, email, role)
      VALUES (${disposableUserId}, ${TENANT_A_ID}, 'mc-del@op.test', 'user')
    `;
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO public.model_calls
        (tenant_id, user_id, model_name, prompt_tokens, completion_tokens, latency_ms)
      VALUES (${TENANT_A_ID}, ${disposableUserId}, 'llama3.3-70b', 7, 3, 50)
      RETURNING id
    `;
    const callId = inserted[0].id;

    // Deleting the user must succeed and leave the usage row behind, actor-link nulled.
    await sql`DELETE FROM public.users WHERE id = ${disposableUserId}`;

    const rows = await sql<{ user_id: string | null }[]>`
      SELECT user_id FROM public.model_calls WHERE id = ${callId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBeNull();

    // Cleanup so this row does not leak into other tests' counts.
    await sql`DELETE FROM public.model_calls WHERE id = ${callId}`;
  });
});

// ---------------------------------------------------------------------------
// audit_logs
// ---------------------------------------------------------------------------

describe("audit_logs", () => {
  it("accepts a tenant-scoped row and round-trips its columns", async () => {
    const resourceId = "11111111-1111-1111-1111-0000000000f0";
    const rows = await sql<
      {
        tenant_id: string | null;
        user_id: string;
        action: string;
        resource_type: string;
        resource_id: string | null;
      }[]
    >`
      INSERT INTO public.audit_logs
        (tenant_id, user_id, action, resource_type, resource_id, ip_address)
      VALUES
        (${TENANT_A_ID}, ${USER_A_ID}, 'document.upload', 'document', ${resourceId}, '203.0.113.7')
      RETURNING tenant_id, user_id, action, resource_type, resource_id
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT_A_ID,
      user_id: USER_A_ID,
      action: "document.upload",
      resource_type: "document",
      resource_id: resourceId,
    });
  });

  it("accepts a fleet-wide row with NULL tenant_id (Option A, SECURITY.md §5)", async () => {
    // Proves tenant_id is genuinely nullable. We intentionally do NOT assert any
    // "actor must be platform_admin" enforcement — that write-path invariant is
    // out of scope for #21 (deferred to M9 / audit-logger layer).
    const rows = await sql<{ tenant_id: string | null; user_id: string }[]>`
      INSERT INTO public.audit_logs
        (tenant_id, user_id, action, resource_type, resource_id)
      VALUES
        (${null}, ${PLATFORM_ADMIN_ID}, 'platform.broadcast', 'fleet', ${null})
      RETURNING tenant_id, user_id
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: null, user_id: PLATFORM_ADMIN_ID });
  });

  it("RLS: Tenant A session sees only its own rows and never the NULL-tenant row", async () => {
    // The NULL-tenant row inserted above must be invisible to a tenant client:
    // SQL three-valued logic means NULL = <jwt tenant_id> is never true.
    const rows = await asUser(TENANT_A_ID, USER_A_ID, (tx) =>
      tx<{ tenant_id: string | null }[]>`SELECT tenant_id FROM public.audit_logs`,
    );
    expect(rows.every((r) => r.tenant_id === TENANT_A_ID)).toBe(true);
    expect(rows.some((r) => r.tenant_id === null)).toBe(false);
  });

  it("blocks deleting a user who has audit_logs rows (user_id ON DELETE RESTRICT, SECURITY.md §5)", async () => {
    // SECURITY.md §5: "user_id is always set, so actor attribution is never lost" and
    // "There is no ad-hoc delete path." A user with audit history must not be deletable
    // out from under their audit rows — RESTRICT must block the delete, and crucially the
    // audit row must still exist afterwards (never silently cascaded away).
    const actorId = "11111111-1111-1111-1111-00000000a101";
    await sql`INSERT INTO auth.users (id, email) VALUES (${actorId}, 'al-actor@op.test')`;
    await sql`
      INSERT INTO public.users (id, tenant_id, email, role)
      VALUES (${actorId}, ${TENANT_A_ID}, 'al-actor@op.test', 'user')
    `;
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type)
      VALUES (${TENANT_A_ID}, ${actorId}, 'document.view', 'document')
      RETURNING id
    `;
    const auditId = inserted[0].id;

    await expect(
      sql`DELETE FROM public.users WHERE id = ${actorId}`,
    ).rejects.toThrow(/violates foreign key constraint .*audit_logs.*/);

    // The audit row — and the actor link — survive the blocked delete.
    const rows = await sql<{ user_id: string }[]>`
      SELECT user_id FROM public.audit_logs WHERE id = ${auditId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(actorId);

    // Cleanup (owner context bypasses the §5 immutability trigger, which is M9 anyway).
    await sql`DELETE FROM public.audit_logs WHERE id = ${auditId}`;
    await sql`DELETE FROM public.users WHERE id = ${actorId}`;
    await sql`DELETE FROM auth.users WHERE id = ${actorId}`;
  });

  it("deleting a tenant preserves its audit_logs rows with tenant_id set to NULL (ON DELETE SET NULL)", async () => {
    // A tenant CASCADE delete would silently destroy that tenant's compliance record
    // (§5: "There is no ad-hoc delete path"). SET NULL keeps the row; tenant_id is already
    // nullable with fleet-wide semantics, so the row becomes tenant-less audit history.
    //
    // The actor is PLATFORM_ADMIN_ID (no tenant, so NOT cascade-deleted when the tenant
    // goes away — users.tenant_id is ON DELETE CASCADE). This isolates the tenant_id
    // SET NULL behaviour from the user_id RESTRICT behaviour: only tenant_id changes here.
    const dispTenantId = "33333333-3333-3333-3333-333333333333";
    await sql`
      INSERT INTO public.tenants (id, name, slug, is_active)
      VALUES (${dispTenantId}, 'Disposable Tenant', 'op-tenant-disp', true)
    `;
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type)
      VALUES (${dispTenantId}, ${PLATFORM_ADMIN_ID}, 'admin.action', 'tenant')
      RETURNING id
    `;
    const auditId = inserted[0].id;

    // Delete the tenant. SET NULL must preserve the audit row, nulling only tenant_id.
    await sql`DELETE FROM public.tenants WHERE id = ${dispTenantId}`;

    const rows = await sql<{ tenant_id: string | null; user_id: string }[]>`
      SELECT tenant_id, user_id FROM public.audit_logs WHERE id = ${auditId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBeNull();
    expect(rows[0].user_id).toBe(PLATFORM_ADMIN_ID); // actor link untouched

    // Cleanup (owner context bypasses the §5 immutability trigger, which is M9 anyway).
    await sql`DELETE FROM public.audit_logs WHERE id = ${auditId}`;
  });
});

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

describe("settings", () => {
  it("accepts a valid insert and round-trips its jsonb value", async () => {
    const rows = await sql<
      {
        tenant_id: string;
        key: string;
        value: unknown;
        updated_by: string | null;
      }[]
    >`
      INSERT INTO public.settings (tenant_id, key, value, updated_by)
      VALUES (${TENANT_A_ID}, 'theme', ${sql.json({ mode: "dark" })}, ${USER_A_ID})
      RETURNING tenant_id, key, value, updated_by
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT_A_ID,
      key: "theme",
      updated_by: USER_A_ID,
    });
    expect(rows[0].value).toEqual({ mode: "dark" });
  });

  it("rejects a duplicate key for the same tenant (settings_tenant_key_uq)", async () => {
    await expect(
      sql`
        INSERT INTO public.settings (tenant_id, key, value)
        VALUES (${TENANT_A_ID}, 'theme', ${sql.json({ mode: "light" })})
      `,
    ).rejects.toThrow(/violates unique constraint "settings_tenant_key_uq"/);
  });

  it("allows the same key for two different tenants", async () => {
    const rows = await sql<{ tenant_id: string; key: string }[]>`
      INSERT INTO public.settings (tenant_id, key, value)
      VALUES (${TENANT_B_ID}, 'theme', ${sql.json({ mode: "dark" })})
      RETURNING tenant_id, key
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: TENANT_B_ID, key: "theme" });
  });

  it("RLS: Tenant A session sees zero of Tenant B's settings", async () => {
    // Mirror of the retrieval_logs/model_calls/audit_logs RLS tests: seed a row for each
    // tenant as owner (bypassing RLS), then assert the Tenant A session sees only its own.
    // Use a distinct key so this test is self-contained regardless of execution order.
    await sql`
      INSERT INTO public.settings (tenant_id, key, value)
      VALUES (${TENANT_A_ID}, 'rls-probe', ${sql.json({ owner: "a" })})
    `;
    await sql`
      INSERT INTO public.settings (tenant_id, key, value)
      VALUES (${TENANT_B_ID}, 'rls-probe', ${sql.json({ owner: "b" })})
    `;
    const rows = await asUser(TENANT_A_ID, USER_A_ID, (tx) =>
      tx<{ tenant_id: string }[]>`SELECT tenant_id FROM public.settings`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === TENANT_A_ID)).toBe(true);
  });
});
