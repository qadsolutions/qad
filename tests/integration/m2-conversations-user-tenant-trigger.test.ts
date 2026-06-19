import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";

/**
 * Integration tests for the conversations<->users tenant-consistency trigger added
 * in #78's third leg (20260618000002_conversations_user_tenant_trigger.sql):
 *
 *   enforce_conversation_user_tenant — BEFORE INSERT OR UPDATE ON conversations
 *
 * conversations.tenant_id is denormalized from the owning user's tenant. The first
 * two legs of #78 (document_chunks vs documents, messages vs conversations) used
 * composite FKs, but this leg can't: users.tenant_id is nullable (NULL only for
 * platform_admin, per #69), which a composite FK to (id, tenant_id) cannot model.
 * A trigger is the backstop instead.
 *
 * These run as the table owner (qad_user), so RLS does not interfere — the point is
 * to prove the DB layer itself refuses a conversation whose tenant_id disagrees with
 * its user's tenant_id, which is exactly the gap a buggy service_role write (RLS
 * bypassed) could otherwise exploit to create a row invisible to its rightful tenant.
 */

const TENANT_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const OTHER_TENANT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const USER_ID = "40000000-0000-0000-0000-000000000001";
const PLATFORM_ADMIN_ID = "40000000-0000-0000-0000-000000000002";

const CONVERSATION_ID = "40000000-0000-0000-0000-000000000010";

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await bootstrapTestDatabase(sql);

  await sql`
    INSERT INTO auth.users (id, email) VALUES
      (${USER_ID}, 'user@m2-conv.test'),
      (${PLATFORM_ADMIN_ID}, 'pa@m2-conv.test')
  `;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active) VALUES
      (${TENANT_ID}, 'Tenant D', 'tenant-d', true),
      (${OTHER_TENANT_ID}, 'Tenant B2', 'tenant-b2', true)
  `;
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role) VALUES
      (${USER_ID}, ${TENANT_ID}, 'user@m2-conv.test', 'admin')
  `;
  // platform_admin has NULL tenant_id (enforced by #69 CHECKs).
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role) VALUES
      (${PLATFORM_ADMIN_ID}, ${null}, 'pa@m2-conv.test', 'platform_admin')
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

describe("conversations user/tenant-consistency trigger (enforce_conversation_user_tenant)", () => {
  it("accepts a conversation whose tenant_id matches its user's tenant_id", async () => {
    const rows = await sql<{ id: string; user_id: string; tenant_id: string }[]>`
      INSERT INTO public.conversations (id, user_id, tenant_id)
      VALUES (${CONVERSATION_ID}, ${USER_ID}, ${TENANT_ID})
      RETURNING id, user_id, tenant_id
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: CONVERSATION_ID,
      user_id: USER_ID,
      tenant_id: TENANT_ID,
    });
  });

  it("rejects a conversation whose tenant_id disagrees with its user's tenant_id", async () => {
    // user_id belongs to TENANT_ID; tenant_id here claims OTHER_TENANT_ID — the
    // exact cross-tenant mismatch a buggy service_role write could otherwise produce.
    await expect(
      sql`
        INSERT INTO public.conversations (user_id, tenant_id)
        VALUES (${USER_ID}, ${OTHER_TENANT_ID})
      `,
    ).rejects.toThrow(/does not match users\.tenant_id/);
  });

  it("rejects a conversation for a platform_admin user (NULL users.tenant_id vs non-NULL conversations.tenant_id)", async () => {
    // platform_admin has no tenant; conversations.tenant_id is NOT NULL, so the
    // NULL-vs-non-NULL comparison must raise rather than silently pass.
    await expect(
      sql`
        INSERT INTO public.conversations (user_id, tenant_id)
        VALUES (${PLATFORM_ADMIN_ID}, ${TENANT_ID})
      `,
    ).rejects.toThrow(/does not match users\.tenant_id/);
  });

  it("rejects an UPDATE that changes tenant_id to disagree with the user's tenant", async () => {
    // The seeded happy-path row exists; flipping its tenant_id must fire the trigger
    // on UPDATE too, not just INSERT.
    await expect(
      sql`
        UPDATE public.conversations
        SET tenant_id = ${OTHER_TENANT_ID}
        WHERE id = ${CONVERSATION_ID}
      `,
    ).rejects.toThrow(/does not match users\.tenant_id/);
  });
});
