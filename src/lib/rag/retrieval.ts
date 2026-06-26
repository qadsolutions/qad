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
 */
export async function searchSimilarChunks(
  supabase: TypedSupabaseClient,
  tenantId: string,
  queryEmbedding: number[],
  topK?: number,
): Promise<ChunkMatch[]> {
  if (queryEmbedding.length !== EMBEDDING_DIM) {
    throw new RangeError(
      `queryEmbedding must be ${EMBEDDING_DIM}-dimensional (nomic-embed-text), got ${queryEmbedding.length}`,
    );
  }

  const k = topK ?? getTopK();

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: toVectorLiteral(queryEmbedding),
    p_tenant_id: tenantId,
    p_top_k: k,
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
