import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";

/**
 * Integration tests for the composite tenant-consistency FKs added in #19's
 * review (#78), 20260617000002_create_core_content_tables.sql:
 *
 *   document_chunks_doc_tenant_fk — (document_id, tenant_id) -> documents (id, tenant_id)
 *   messages_conv_tenant_fk       — (conversation_id, tenant_id) -> conversations (id, tenant_id)
 *
 * tenant_id is denormalized on document_chunks/messages so chunk/message-level
 * RLS doesn't need a join. These run as the table owner (qad_user), so RLS does
 * not interfere — the point is to prove the DB layer itself refuses a row whose
 * tenant_id disagrees with its parent's, which is exactly the gap a service_role
 * write bug could otherwise exploit (service_role bypasses RLS entirely).
 */

const TENANT_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const OTHER_TENANT_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const USER_ID = "30000000-0000-0000-0000-000000000001";
const DOCUMENT_ID = "30000000-0000-0000-0000-000000000002";
const CONVERSATION_ID = "30000000-0000-0000-0000-000000000003";

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await bootstrapTestDatabase(sql);

  await sql`INSERT INTO auth.users (id, email) VALUES (${USER_ID}, 'check@m2-fk.test')`;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active) VALUES
      (${TENANT_ID}, 'Tenant E', 'tenant-e', true),
      (${OTHER_TENANT_ID}, 'Tenant F', 'tenant-f', true)
  `;
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role)
    VALUES (${USER_ID}, ${TENANT_ID}, 'check@m2-fk.test', 'admin')
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

describe("document_chunks tenant-consistency FK (document_chunks_doc_tenant_fk)", () => {
  it("accepts a chunk whose tenant_id matches its document's tenant_id", async () => {
    const rows = await sql<{ document_id: string; tenant_id: string }[]>`
      INSERT INTO public.document_chunks (document_id, tenant_id, chunk_text, chunk_index, token_count)
      VALUES (${DOCUMENT_ID}, ${TENANT_ID}, 'hello', 0, 1)
      RETURNING document_id, tenant_id
    `;
    expect(rows[0]).toMatchObject({ document_id: DOCUMENT_ID, tenant_id: TENANT_ID });
  });

  it("rejects a chunk whose tenant_id disagrees with its document's tenant_id", async () => {
    // document_id belongs to TENANT_ID; tenant_id here claims OTHER_TENANT_ID — the
    // exact cross-tenant mismatch a buggy service_role write could otherwise produce.
    await expect(
      sql`
        INSERT INTO public.document_chunks (document_id, tenant_id, chunk_text, chunk_index, token_count)
        VALUES (${DOCUMENT_ID}, ${OTHER_TENANT_ID}, 'evil', 1, 1)
      `,
    ).rejects.toThrow(/violates foreign key constraint "document_chunks_doc_tenant_fk"/);
  });

  it("rejects a duplicate chunk_index within the same document (document_chunks_doc_chunk_index_uq)", async () => {
    await expect(
      sql`
        INSERT INTO public.document_chunks (document_id, tenant_id, chunk_text, chunk_index, token_count)
        VALUES (${DOCUMENT_ID}, ${TENANT_ID}, 'duplicate index', 0, 1)
      `,
    ).rejects.toThrow(/violates unique constraint "document_chunks_doc_chunk_index_uq"/);
  });
});

describe("messages tenant-consistency FK (messages_conv_tenant_fk)", () => {
  it("accepts a message whose tenant_id matches its conversation's tenant_id", async () => {
    const rows = await sql<{ conversation_id: string; tenant_id: string }[]>`
      INSERT INTO public.messages (conversation_id, tenant_id, role, content)
      VALUES (${CONVERSATION_ID}, ${TENANT_ID}, 'user', 'hi')
      RETURNING conversation_id, tenant_id
    `;
    expect(rows[0]).toMatchObject({ conversation_id: CONVERSATION_ID, tenant_id: TENANT_ID });
  });

  it("rejects a message whose tenant_id disagrees with its conversation's tenant_id", async () => {
    // conversation_id belongs to TENANT_ID; tenant_id here claims OTHER_TENANT_ID.
    await expect(
      sql`
        INSERT INTO public.messages (conversation_id, tenant_id, role, content)
        VALUES (${CONVERSATION_ID}, ${OTHER_TENANT_ID}, 'user', 'evil')
      `,
    ).rejects.toThrow(/violates foreign key constraint "messages_conv_tenant_fk"/);
  });
});
