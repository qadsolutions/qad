/**
 * Integration tests for the similarity-threshold gate (issue #97).
 *
 * Verifies that `searchSimilarChunks` filters out chunks whose cosine similarity
 * falls below `RAG_MIN_SIMILARITY`, and returns an empty array when no chunk
 * survives the threshold — the signal the query endpoint (#30) uses to skip
 * inference and emit the no-context guardrail response.
 *
 * Uses orthogonal unit vectors (hot at a single dimension) so similarity values
 * are deterministic:
 *   - query hot at dim X  vs  chunk hot at dim X  →  similarity ≈ 1.0
 *   - query hot at dim X  vs  chunk hot at dim Y  →  similarity ≈ 0.0
 *
 * The test creates a thin postgres-backed client stub that forwards
 * `supabase.rpc("match_chunks", ...)` to the raw SQL function — the same
 * pattern the rest of this integration suite uses (no local PostgREST
 * available; see retrieval-eval.test.ts for the rationale).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";
import { unitish, vectorLiteral } from "../helpers/vector-test-utils";
import { searchSimilarChunks } from "@/lib/rag/retrieval";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Postgres-backed supabase stub
// ---------------------------------------------------------------------------

type MatchChunksRow = {
  chunk_id: string;
  document_id: string;
  chunk_text: string;
  similarity: number;
};

/**
 * Return a minimal TypedSupabaseClient whose `rpc("match_chunks", ...)` call
 * is forwarded to the real `match_chunks` PostgreSQL function via the raw
 * postgres driver. This lets us test `searchSimilarChunks` end-to-end
 * (including the threshold filter) without a PostgREST endpoint.
 */
function makeTestClient(sql: ReturnType<typeof postgres>): TypedSupabaseClient {
  return {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      if (fn !== "match_chunks") {
        throw new Error(`Unexpected rpc function: ${fn}`);
      }
      try {
        const rows = await sql<MatchChunksRow[]>`
          SELECT chunk_id, document_id, chunk_text, similarity
          FROM match_chunks(
            ${params.query_embedding as string},
            ${params.p_tenant_id as string}::uuid,
            ${params.p_top_k as number}
          )
        `;
        return { data: rows, error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { data: null, error: { message } };
      }
    },
  } as unknown as TypedSupabaseClient;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = "cc000000-0000-0000-0000-000000000001";
const USER_ID   = "cc000000-0000-0000-0000-000000000002";
const DOC_ID    = "cc000000-0000-0000-0000-000000000003";

// Chunk hot at dim 10 — near-perfect match to a query hot at dim 10 (sim ≈ 1.0).
const CHUNK_NEAR_ID = "cc000000-0000-0000-0000-000000000011";
// Chunk hot at dim 20 — orthogonal to query at dim 10 (sim ≈ 0.0).
const CHUNK_FAR_ID  = "cc000000-0000-0000-0000-000000000012";

let sql: ReturnType<typeof postgres>;
let client: TypedSupabaseClient;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  client = makeTestClient(sql);
  await bootstrapTestDatabase(sql);

  await sql`
    INSERT INTO auth.users (id, email)
    VALUES (${USER_ID}, 'user@threshold.test')
  `;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active)
    VALUES (${TENANT_ID}, 'Threshold Test Tenant', 'threshold-test', true)
  `;
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role)
    VALUES (${USER_ID}, ${TENANT_ID}, 'user@threshold.test', 'admin')
  `;
  await sql`
    INSERT INTO public.documents (id, tenant_id, filename, file_type, storage_path, status)
    VALUES (${DOC_ID}, ${TENANT_ID}, 'threshold-test.md', 'md',
            ${`${TENANT_ID}/${DOC_ID}/threshold-test.md`}, 'ready')
  `;
  await sql`
    INSERT INTO public.document_chunks (id, document_id, tenant_id, chunk_text, chunk_index, token_count)
    VALUES
      (${CHUNK_NEAR_ID}, ${DOC_ID}, ${TENANT_ID}, 'near-match chunk (dim 10)', 0, 4),
      (${CHUNK_FAR_ID},  ${DOC_ID}, ${TENANT_ID}, 'far-match chunk (dim 20)',  1, 4)
  `;
  await sql`
    INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version)
    VALUES
      (${CHUNK_NEAR_ID}, ${TENANT_ID}, ${vectorLiteral(unitish(10))}::vector, 'nomic-embed-text'),
      (${CHUNK_FAR_ID},  ${TENANT_ID}, ${vectorLiteral(unitish(20))}::vector, 'nomic-embed-text')
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Query vector hot at dim 10 (near CHUNK_NEAR, orthogonal to CHUNK_FAR).
const QUERY_NEAR_DIM_10 = unitish(10);
// Query vector hot at dim 30 (orthogonal to BOTH seeded chunks — all below any positive threshold).
const QUERY_UNRELATED = unitish(30);

describe("searchSimilarChunks — similarity threshold (RAG_MIN_SIMILARITY) integration", () => {
  it("returns all chunks when threshold is unset (permissive default 0.0)", async () => {
    vi.stubEnv("RAG_MIN_SIMILARITY", "");

    const results = await searchSimilarChunks(client, TENANT_ID, QUERY_NEAR_DIM_10);

    // Both chunks should survive: CHUNK_NEAR (sim ≈ 1.0) and CHUNK_FAR (sim ≈ 0.0),
    // both >= 0.0 default threshold.
    expect(results.length).toBeGreaterThanOrEqual(1);
    const ids = results.map((r) => r.chunkId);
    expect(ids).toContain(CHUNK_NEAR_ID);
  });

  it("returns empty array when all chunks are below the threshold (all-below case)", async () => {
    // Query hot at dim 30 is orthogonal to both seeded chunks (sim ≈ 0.0 for each).
    // Threshold 0.5 excludes everything.
    vi.stubEnv("RAG_MIN_SIMILARITY", "0.5");

    const results = await searchSimilarChunks(client, TENANT_ID, QUERY_UNRELATED);

    expect(results).toEqual([]);
  });

  it("returns only the qualifying chunk when query is near one and far from the other", async () => {
    // Query hot at dim 10: CHUNK_NEAR has sim ≈ 1.0 (passes), CHUNK_FAR has sim ≈ 0.0 (fails).
    vi.stubEnv("RAG_MIN_SIMILARITY", "0.5");

    const results = await searchSimilarChunks(client, TENANT_ID, QUERY_NEAR_DIM_10);

    const ids = results.map((r) => r.chunkId);
    expect(ids).toContain(CHUNK_NEAR_ID);
    expect(ids).not.toContain(CHUNK_FAR_ID);
  });

  it("honours a threshold set close to 1 (accepts the near-perfect match only)", async () => {
    vi.stubEnv("RAG_MIN_SIMILARITY", "0.9");

    const results = await searchSimilarChunks(client, TENANT_ID, QUERY_NEAR_DIM_10);

    // CHUNK_NEAR similarity is ≈ 1.0, which is >= 0.9; CHUNK_FAR is ≈ 0.0 and filtered.
    const ids = results.map((r) => r.chunkId);
    expect(ids).toContain(CHUNK_NEAR_ID);
    expect(ids).not.toContain(CHUNK_FAR_ID);
  });
});
