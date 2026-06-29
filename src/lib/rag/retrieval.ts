/**
 * Tenant-filtered vector similarity search (issue #28).
 *
 * The `searchSimilarChunks` function is the RAG retrieval step: embed the user's
 * question, call this, receive the top-k most-similar chunks, and build the prompt.
 *
 * It delegates to the `match_chunks` PostgreSQL function
 * (20260625000001_match_chunks_fn.sql), which:
 *   - raises `hnsw.ef_search` per query to mitigate multi-tenant post-filter
 *     recall loss on the shared HNSW index,
 *   - applies `WHERE tenant_id = p_tenant_id` as defense-in-depth, and
 *   - JOINs `embeddings → document_chunks` to return chunk text for prompt
 *     construction without a second round-trip.
 *
 * Pass the authenticated Supabase client (from `withTenant`) for the Client
 * Portal query path — RLS scopes the scan to the caller's tenant automatically.
 * Pass the admin client for service-level access; in that case p_tenant_id is
 * the only isolation guard, and it must come from the verified JWT, not the
 * request body.
 */

import { EMBEDDING_DIM } from "@/lib/ingestion/embedder";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/** One result row from the similarity search. */
export interface ChunkMatch {
  chunkId: string;
  documentId: string;
  chunkText: string;
  /** Cosine similarity ∈ [-1, 1]. Higher is closer. */
  similarity: number;
}

/** Serialise a number[] to pgvector's text literal '[v0,…,v767]'. */
function toVectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

/** Read `RAG_TOP_K` from the environment; defaults to 5 if unset or invalid. */
export function getTopK(): number {
  const raw = process.env.RAG_TOP_K;
  if (!raw) return 5;
  const parsed = parseInt(raw, 10);
  if (parsed > 0) return parsed;
  console.warn(
    `RAG_TOP_K="${raw}" is not a valid positive integer; defaulting to 5`,
  );
  return 5;
}

/**
 * Read `RAG_HNSW_EF_SEARCH` from the environment; defaults to 100 if unset or
 * invalid.
 *
 * ef_search controls how many candidates the HNSW graph traversal keeps in its
 * priority queue before applying the tenant_id post-filter. A higher value
 * improves recall at the cost of slightly more CPU per query. 100 is 2.5× the
 * pgvector default (40) — sufficient for most multi-tenant workloads. Increase
 * if tenants reliably return fewer than top-k results at scale, or if the ratio
 * of inter-tenant to intra-tenant vectors is high.
 *
 * Trade-off: each doubling of ef_search roughly doubles traversal work. Above
 * ~400, diminishing returns typically set in. Benchmark before increasing beyond
 * the default for latency-sensitive deployments (target: < 200ms per query).
 */
export function getEfSearch(): number {
  const raw = process.env.RAG_HNSW_EF_SEARCH;
  if (!raw) return 100;
  const parsed = parseInt(raw, 10);
  if (parsed > 0) return parsed;
  console.warn(
    `RAG_HNSW_EF_SEARCH="${raw}" is not a valid positive integer; defaulting to 100`,
  );
  return 100;
}

/**
 * Return the top-k document chunks most similar to `queryEmbedding`, scoped to
 * `tenantId`.
 *
 * @param supabase       Caller's Supabase client. Prefer the authenticated client
 *                       (from `withTenant`) so RLS enforces isolation automatically.
 * @param tenantId       Validated tenant_id from the caller's JWT — never from the
 *                       request body.
 * @param queryEmbedding 768-dim query vector (nomic-embed-text). Must have exactly
 *                       768 dimensions — throws RangeError otherwise.
 * @param topK           Number of results to return. Defaults to `RAG_TOP_K` env
 *                       var (default 5).
 * @param efSearch       HNSW candidate window size passed as `p_ef_search` to
 *                       `match_chunks`. Defaults to `RAG_HNSW_EF_SEARCH` env var
 *                       (default 100). See `getEfSearch()` for the trade-off notes.
 */
export async function searchSimilarChunks(
  supabase: TypedSupabaseClient,
  tenantId: string,
  queryEmbedding: number[],
  topK?: number,
  efSearch?: number,
): Promise<ChunkMatch[]> {
  if (queryEmbedding.length !== EMBEDDING_DIM) {
    throw new RangeError(
      `queryEmbedding must be ${EMBEDDING_DIM}-dimensional (nomic-embed-text), got ${queryEmbedding.length}`,
    );
  }

  const k = topK ?? getTopK();
  const ef = efSearch ?? getEfSearch();

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: toVectorLiteral(queryEmbedding),
    p_tenant_id: tenantId,
    p_top_k: k,
    p_ef_search: ef,
  });

  if (error) {
    throw new Error(`Vector similarity search failed: ${error.message}`, {
      cause: error,
    });
  }

  if (data === null) {
    throw new Error(
      "Vector similarity search returned null data with no error — unexpected PostgREST response",
    );
  }

  return data.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    chunkText: row.chunk_text,
    similarity: row.similarity,
  }));
}
