import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";

/**
 * Integration tests for the two CHECK constraints added in #19
 * (20260617000002_create_core_content_tables.sql):
 *
 *   documents_status_check — status IN (uploading, processing, ready, error)
 *   messages_role_check    — role   IN (user, assistant, system)
 *
 * These run as the table owner (qad_user), so RLS does not interfere — the point
 * is to prove the DB layer itself refuses out-of-range values. Without this, a
 * typo in the migration (e.g. "uplading") would silently widen or narrow the
 * accepted value set and no other layer would catch it.
 */

const TENANT_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const USER_ID = "20000000-0000-0000-0000-000000000001";
const DOCUMENT_ID = "20000000-0000-0000-0000-000000000002";
const CONVERSATION_ID = "20000000-0000-0000-0000-000000000003";

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await bootstrapTestDatabase(sql);

  await sql`INSERT INTO auth.users (id, email) VALUES (${USER_ID}, 'check@m2.test')`;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active)
    VALUES (${TENANT_ID}, 'Tenant D', 'tenant-d', true)
  `;
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role)
    VALUES (${USER_ID}, ${TENANT_ID}, 'check@m2.test', 'admin')
  `;
  await sql`
    INSERT INTO public.documents (id, tenant_id, filename, file_type, storage_path, status)
    VALUES (${DOCUMENT_ID}, ${TENANT_ID}, 'f.pdf', 'pdf', ${TENANT_ID + "/" + DOCUMENT_ID + "/f.pdf"}, 'ready')
  `;
  await sql`
    INSERT INTO public.conversations (id, user_id, tenant_id)
    VALUES (${CONVERSATION_ID}, ${USER_ID}, ${TENANT_ID})
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

describe("documents.status CHECK constraint (documents_status_check)", () => {
  it.each(["uploading", "processing", "ready", "error"])("accepts status %s", async (status) => {
    const rows = await sql<{ status: string }[]>`
      INSERT INTO public.documents (tenant_id, filename, file_type, storage_path, status)
      VALUES (${TENANT_ID}, 'ok.pdf', 'pdf', 'path/ok.pdf', ${status})
      RETURNING status
    `;
    expect(rows[0].status).toBe(status);
  });

  it("rejects an out-of-range status", async () => {
    await expect(
      sql`
        INSERT INTO public.documents (tenant_id, filename, file_type, storage_path, status)
        VALUES (${TENANT_ID}, 'bad.pdf', 'pdf', 'path/bad.pdf', 'uplading')
      `,
    ).rejects.toThrow(/violates check constraint "documents_status_check"/);
  });
});

describe("messages.role CHECK constraint (messages_role_check)", () => {
  it.each(["user", "assistant", "system"])("accepts role %s", async (role) => {
    const rows = await sql<{ role: string }[]>`
      INSERT INTO public.messages (conversation_id, tenant_id, role, content)
      VALUES (${CONVERSATION_ID}, ${TENANT_ID}, ${role}, 'hi')
      RETURNING role
    `;
    expect(rows[0].role).toBe(role);
  });

  it("rejects an out-of-range role", async () => {
    await expect(
      sql`
        INSERT INTO public.messages (conversation_id, tenant_id, role, content)
        VALUES (${CONVERSATION_ID}, ${TENANT_ID}, 'tool', 'hi')
      `,
    ).rejects.toThrow(/violates check constraint "messages_role_check"/);
  });
});
