import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";
import { createAsUser } from "../helpers/as-user";
import { chunkText } from "@/lib/ingestion/chunking";
import { createEmbedder } from "@/lib/ingestion/embedder";

/**
 * Integration coverage for issue #25's bulk-insert shape against a real pgvector DB.
 *
 * DEVIATION FROM PLAN (documented per task instructions): the original plan called
 * `chunkAndEmbed()` directly here. `chunkAndEmbed()` writes through
 * `createSupabaseAdminClient()` — a real `@supabase/supabase-js` client that talks
 * to PostgREST over HTTP, not a raw Postgres connection. Neither this repo's CI
 * service container (bare `pgvector/pgvector:pg16`, no PostgREST/Kong) nor the
 * throwaway-container fallback this task specifies expose a PostgREST endpoint, so
 * calling `chunkAndEmbed()` here fails with a JWT-parse error against the
 * placeholder `SUPABASE_SERVICE_ROLE_KEY` `vitest.config.ts` supplies — confirmed
 * by reproducing the exact failure locally. This is not specific to this task: every
 * existing integration test in tests/integration/ (tenant-isolation.test.ts,
 * m2-embeddings.test.ts, m2-operational-tables.test.ts, storage-isolation.test.ts)
 * already avoids this by writing through the raw `postgres` driver directly and
 * replicating PostgREST's two session-setup statements itself (see
 * tests/helpers/as-user.ts) — none of them route real inserts through
 * createSupabaseAdminClient(). This test follows that same established convention:
 * it exercises the real `chunkText()` and `createEmbedder()` units (the parts of
 * #25's logic that don't depend on Supabase-JS), builds the same row shapes
 * `chunkAndEmbed()` builds, and inserts them via the raw `sql` connection — proving
 * the schema (composite FKs, `vector(768)` column, RLS) accepts exactly what
 * `chunkAndEmbed()` would produce. `chunkAndEmbed()`'s own insert/cleanup logic is
 * already fully covered against a mocked client in tests/unit/chunk-and-embed.test.ts
 * (Task B4) — this file adds the DB-level proof Task B4's mock can't provide.
 */

const TENANT_A_ID = "11111111-1111-1111-1111-111111111111";
const USER_A_ID = "11111111-1111-1111-1111-000000000001";
const DOC_A_ID = "11111111-1111-1111-1111-0000000000a1";

let sql: ReturnType<typeof postgres>;
let asUser: ReturnType<typeof createAsUser>;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  asUser = createAsUser(sql);
  await bootstrapTestDatabase(sql);

  await sql`INSERT INTO auth.users (id, email) VALUES (${USER_A_ID}, 'usera@chunkembed.test')`;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active)
    VALUES (${TENANT_A_ID}, 'Tenant A', 'tenant-a-chunkembed', true)
  `;
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role)
    VALUES (${USER_A_ID}, ${TENANT_A_ID}, 'usera@chunkembed.test', 'admin')
  `;
  await sql`
    INSERT INTO public.documents (id, tenant_id, filename, file_type, storage_path, status)
    VALUES (${DOC_A_ID}, ${TENANT_A_ID}, 'a.txt', 'txt', ${TENANT_A_ID + "/" + DOC_A_ID + "/a.txt"}, 'processing')
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

beforeEach(() => {
  vi.stubEnv("INFERENCE_PROVIDER", "mock");
});

/** pgvector's text literal form — same helper chunk-and-embed.ts uses internally. */
function toVectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

/**
 * Build the same `document_chunks` + `embeddings` row shapes `chunkAndEmbed()`
 * builds (src/lib/ingestion/chunk-and-embed.ts), using the real chunking +
 * embedding units, without going through `createSupabaseAdminClient()`.
 */
async function buildChunkAndEmbeddingRows(documentId: string, tenantId: string, text: string) {
  const textChunks = chunkText(text);
  const embedder = createEmbedder();
  const vectors = await embedder.embed(textChunks.map((chunk) => chunk.text));

  const chunkRows = textChunks.map((chunk) => ({
    id: crypto.randomUUID(),
    document_id: documentId,
    tenant_id: tenantId,
    chunk_text: chunk.text,
    chunk_index: chunk.index,
    token_count: chunk.tokenCount,
  }));

  const embeddingRows = chunkRows.map((chunk, i) => ({
    chunk_id: chunk.id,
    tenant_id: tenantId,
    embedding: toVectorLiteral(vectors[i]),
    model_version: embedder.modelVersion,
  }));

  return { chunkRows, embeddingRows };
}

describe("chunk-and-embed row shapes against a real pgvector DB (#25)", () => {
  it("writes chunks + 768-dim embeddings that satisfy the composite FKs and are visible under RLS", async () => {
    const text = "alpha beta gamma delta ".repeat(300); // 3 chunks at default size/overlap
    const { chunkRows, embeddingRows } = await buildChunkAndEmbeddingRows(
      DOC_A_ID,
      TENANT_A_ID,
      text,
    );
    expect(chunkRows).toHaveLength(3);

    for (const row of chunkRows) {
      await sql`
        INSERT INTO public.document_chunks
          (id, document_id, tenant_id, chunk_text, chunk_index, token_count)
        VALUES (${row.id}, ${row.document_id}, ${row.tenant_id}, ${row.chunk_text}, ${row.chunk_index}, ${row.token_count})
      `;
    }
    for (const row of embeddingRows) {
      await sql`
        INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version)
        VALUES (${row.chunk_id}, ${row.tenant_id}, ${row.embedding}::vector, ${row.model_version})
      `;
    }

    const chunkDbRows = await sql`
      SELECT id, chunk_index, token_count FROM public.document_chunks
      WHERE document_id = ${DOC_A_ID} ORDER BY chunk_index
    `;
    expect(chunkDbRows).toHaveLength(3);
    expect(chunkDbRows.map((r) => r.chunk_index)).toEqual([0, 1, 2]);

    const embeddingDbRows = await sql`
      SELECT e.chunk_id, e.model_version, vector_dims(e.embedding) AS dims
      FROM public.embeddings e
      JOIN public.document_chunks c ON c.id = e.chunk_id
      WHERE c.document_id = ${DOC_A_ID}
    `;
    expect(embeddingDbRows).toHaveLength(3);
    for (const row of embeddingDbRows) {
      expect(row.dims).toBe(768);
      expect(row.model_version).toBe("mock");
    }

    // RLS visibility: Tenant A's own user can select what was just written.
    await asUser(TENANT_A_ID, USER_A_ID, async (userSql) => {
      const visible = await userSql`
        SELECT id FROM public.document_chunks WHERE document_id = ${DOC_A_ID}
      `;
      expect(visible).toHaveLength(3);
    });
  });

  it("a non-existent tenantId is rejected by the DB's own FK (defense in depth), and leaves zero chunks behind", async () => {
    // document_chunks.tenant_id references tenants(id) — a tenantId that isn't a
    // real row is a genuine, easily-triggered constraint violation, independent of
    // chunk_id (which is freshly generated per call and can't otherwise collide).
    // This proves the DB itself backstops a bad tenantId even though application
    // code never explicitly checks tenant existence before inserting — same
    // "DB-as-backstop-for-service_role-writes" reasoning as the composite FKs
    // documented in 20260617000002_create_core_content_tables.sql.
    const fakeTenantId = "99999999-9999-9999-9999-999999999999";
    const { chunkRows } = await buildChunkAndEmbeddingRows(
      DOC_A_ID,
      fakeTenantId,
      "some text content here",
    );

    await expect(
      sql`
        INSERT INTO public.document_chunks
          (id, document_id, tenant_id, chunk_text, chunk_index, token_count)
        VALUES (${chunkRows[0].id}, ${chunkRows[0].document_id}, ${chunkRows[0].tenant_id}, ${chunkRows[0].chunk_text}, ${chunkRows[0].chunk_index}, ${chunkRows[0].token_count})
      `,
    ).rejects.toThrow();

    const leaked = await sql`SELECT id FROM public.document_chunks WHERE tenant_id = ${fakeTenantId}`;
    expect(leaked).toHaveLength(0);
  });
});
