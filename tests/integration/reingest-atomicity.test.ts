import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";
import { createAsUser } from "../helpers/as-user";
import { EMBEDDING_DIM } from "@/lib/ingestion/embedder";

/**
 * Integration coverage for the atomic re-ingestion RPC (issue #26, decision D1)
 * against a real pgvector DB.
 *
 * WHY THE RAW `postgres` DRIVER, NOT supabase-js: identical to the reason
 * documented in tests/integration/chunk-and-embed.test.ts — `reingest_document_chunks`
 * is invoked in production through `createSupabaseAdminClient()`, a supabase-js client
 * that talks to PostgREST over HTTP. This repo's CI service container (bare
 * `pgvector/pgvector:pg16`) and the local test DB expose no PostgREST endpoint, so a
 * supabase-js `.rpc()` call here fails at the HTTP/JWT layer. Every existing integration
 * test instead drives the DB directly via the raw `postgres` driver (replicating
 * PostgREST's session setup in tests/helpers/as-user.ts). This test follows that
 * convention: it calls the SQL function `reingest_document_chunks` directly via `sql`,
 * which exercises exactly the plpgsql body chunkAndEmbed's `.rpc()` would invoke —
 * proving the schema-level atomicity (D1) the unit test's mock cannot.
 */

const TENANT_A_ID = "22222222-2222-2222-2222-222222222222";
const USER_A_ID = "22222222-2222-2222-2222-000000000001";
const DOC_A_ID = "22222222-2222-2222-2222-0000000000a1";

let sql: ReturnType<typeof postgres>;
let asUser: ReturnType<typeof createAsUser>;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  asUser = createAsUser(sql);
  await bootstrapTestDatabase(sql);

  await sql`INSERT INTO auth.users (id, email) VALUES (${USER_A_ID}, 'usera@reingest.test')`;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active)
    VALUES (${TENANT_A_ID}, 'Tenant A', 'tenant-a-reingest', true)
  `;
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role)
    VALUES (${USER_A_ID}, ${TENANT_A_ID}, 'usera@reingest.test', 'admin')
  `;
  await sql`
    INSERT INTO public.documents (id, tenant_id, filename, file_type, storage_path, status)
    VALUES (${DOC_A_ID}, ${TENANT_A_ID}, 'a.txt', 'txt', ${TENANT_A_ID + "/" + DOC_A_ID + "/a.txt"}, 'processing')
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

/** A unique EMBEDDING_DIM-length vector literal — `seed` just varies the values. */
function vectorLiteral(seed: number, dims = EMBEDDING_DIM): string {
  return `[${Array.from({ length: dims }, (_, i) => ((seed + i) % 7) / 10).join(",")}]`;
}

/** Build the JSON payload reingest_document_chunks expects: N chunks, each with a vector. */
function buildPayload(count: number, opts: { dupIndex?: boolean; badDim?: boolean } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: crypto.randomUUID(),
    chunk_text: `chunk text ${i}`,
    // dupIndex: collide chunk_index 0 to violate document_chunks_doc_chunk_index_uq.
    chunk_index: opts.dupIndex ? 0 : i,
    token_count: 5 + i,
    // badDim: a wrong-dimensionality vector the vector(768) column must reject.
    embedding: opts.badDim ? vectorLiteral(i, 4) : vectorLiteral(i),
  }));
}

async function callReingest(payload: ReturnType<typeof buildPayload>) {
  return sql`
    SELECT public.reingest_document_chunks(
      ${DOC_A_ID}::uuid,
      ${TENANT_A_ID}::uuid,
      ${sql.json(payload)}::jsonb,
      ${"mock"}::text
    ) AS inserted
  `;
}

async function chunkCount(): Promise<number> {
  const rows = await sql`SELECT count(*)::int AS n FROM public.document_chunks WHERE document_id = ${DOC_A_ID}`;
  return rows[0].n as number;
}

async function embeddingCount(): Promise<number> {
  const rows = await sql`
    SELECT count(*)::int AS n
    FROM public.embeddings e
    JOIN public.document_chunks c ON c.id = e.chunk_id
    WHERE c.document_id = ${DOC_A_ID}
  `;
  return rows[0].n as number;
}

beforeEach(async () => {
  // Reset to a known-empty state before each case.
  await sql`DELETE FROM public.document_chunks WHERE document_id = ${DOC_A_ID}`;
});

describe("reingest_document_chunks atomicity (#26, D1)", () => {
  it("inserts chunks + embeddings on first ingest (delete is a no-op) and returns the count", async () => {
    const result = await callReingest(buildPayload(3));
    expect(result[0].inserted).toBe(3);
    expect(await chunkCount()).toBe(3);
    expect(await embeddingCount()).toBe(3);
  });

  it("replaces ALL old chunks + embeddings on re-ingest, leaving no orphans", async () => {
    await callReingest(buildPayload(3));
    const firstChunks = await sql`SELECT id FROM public.document_chunks WHERE document_id = ${DOC_A_ID}`;
    const firstIds = firstChunks.map((r) => r.id as string).sort();

    const result = await callReingest(buildPayload(2));
    expect(result[0].inserted).toBe(2);

    // New set present, old set fully gone (embeddings cascade-deleted with their chunks).
    expect(await chunkCount()).toBe(2);
    expect(await embeddingCount()).toBe(2);
    const afterChunks = await sql`SELECT id FROM public.document_chunks WHERE document_id = ${DOC_A_ID}`;
    const afterIds = afterChunks.map((r) => r.id as string).sort();
    expect(afterIds.some((id) => firstIds.includes(id))).toBe(false);
    // No embedding rows survive that no longer point at a current chunk.
    const orphans = await sql`
      SELECT count(*)::int AS n FROM public.embeddings e
      WHERE e.tenant_id = ${TENANT_A_ID}
        AND NOT EXISTS (SELECT 1 FROM public.document_chunks c WHERE c.id = e.chunk_id)
    `;
    expect(orphans[0].n).toBe(0);
  });

  it("rolls back entirely on a duplicate chunk_index, leaving the ORIGINAL chunks intact (D1)", async () => {
    await callReingest(buildPayload(3));
    expect(await chunkCount()).toBe(3);

    // A payload whose inserts violate document_chunks_doc_chunk_index_uq. The function
    // body is one transaction, so its leading DELETE must roll back too: the original
    // 3 chunks survive rather than the document being left empty/half-wiped.
    await expect(callReingest(buildPayload(3, { dupIndex: true }))).rejects.toThrow();

    expect(await chunkCount()).toBe(3);
    expect(await embeddingCount()).toBe(3);
  });

  it("rolls back entirely on a wrong-dimension embedding, leaving the ORIGINAL chunks intact (D1)", async () => {
    await callReingest(buildPayload(2));
    expect(await chunkCount()).toBe(2);

    // The chunk inserts would succeed but the 4-dim vector is rejected by vector(768).
    // Because that happens inside the same transaction, the chunk inserts and the
    // leading DELETE all roll back — the prior good state is preserved.
    await expect(callReingest(buildPayload(2, { badDim: true }))).rejects.toThrow();

    expect(await chunkCount()).toBe(2);
    expect(await embeddingCount()).toBe(2);
  });

  it("written rows are visible to the owning tenant under RLS", async () => {
    await callReingest(buildPayload(2));
    await asUser(TENANT_A_ID, USER_A_ID, async (userSql) => {
      const visible = await userSql`SELECT id FROM public.document_chunks WHERE document_id = ${DOC_A_ID}`;
      expect(visible).toHaveLength(2);
    });
  });
});
