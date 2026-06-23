import { chunkText } from "@/lib/ingestion/chunking";
import { assertEmbeddingDimensions, createEmbedder } from "@/lib/ingestion/embedder";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type IngestionErrorCode = "no_chunks" | "persist_failed";

export class IngestionError extends Error {
  constructor(
    readonly code: IngestionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IngestionError";
  }
}

/** pgvector's text literal form — the generated `embeddings.embedding` column type is `string`. */
function toVectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

/**
 * Chunk `text`, embed each chunk, and persist the `document_chunks` + `embeddings`
 * rows for `documentId`, every row scoped to `tenantId` (issues #25, #26).
 *
 * `tenantId` is always passed in by the caller (the worker, #26, which already
 * has it from the `documents` row) — never re-derived here, matching the
 * tenant-scoping convention #23 established.
 *
 * Embedding runs before any DB write, so the most common failure (Ollama
 * unreachable) never touches the database.
 *
 * Persistence goes through the `reingest_document_chunks` RPC, not two separate
 * `.insert()` calls (decision D1, docs/m3-plan.md). supabase-js can't run a
 * multi-statement transaction over PostgREST, so the atomic "delete all old
 * chunks/embeddings for this document, then insert the new set" is a single
 * plpgsql function whose body is one implicit transaction. That makes first
 * ingest and re-ingest the SAME path — the delete is a no-op on first ingest —
 * and means a mid-failure rolls back to the prior good state rather than leaving
 * the document half-wiped (the manual compensating-delete this function replaced
 * could not guarantee that). The chunk ids are generated here so each chunk and
 * its vector travel together in one payload element and can never be mispaired.
 */
export async function chunkAndEmbed(
  documentId: string,
  tenantId: string,
  text: string,
): Promise<{ chunkCount: number }> {
  const textChunks = chunkText(text);
  if (textChunks.length === 0) {
    throw new IngestionError("no_chunks", "No chunks produced from the given text");
  }

  const embedder = createEmbedder();
  const vectors = await embedder.embed(textChunks.map((chunk) => chunk.text));
  // OllamaEmbedder already validates this internally (Task B3) — checking again
  // here is deliberate defense-in-depth, not redundancy: it means a future third
  // Embedder implementation that forgets to self-validate is still caught before
  // any DB write, not just whichever implementations happen to remember to.
  assertEmbeddingDimensions(vectors);

  const supabase = createSupabaseAdminClient();

  // One payload element per chunk, carrying both the chunk columns and its vector
  // literal under a single generated id — the shape reingest_document_chunks reads.
  const chunks = textChunks.map((chunk, i) => ({
    id: crypto.randomUUID(),
    chunk_text: chunk.text,
    chunk_index: chunk.index,
    token_count: chunk.tokenCount,
    embedding: toVectorLiteral(vectors[i]),
  }));

  const { error } = await supabase.rpc("reingest_document_chunks", {
    p_document_id: documentId,
    p_tenant_id: tenantId,
    p_chunks: chunks,
    p_model_version: embedder.modelVersion,
  });
  if (error) {
    throw new IngestionError("persist_failed", error.message);
  }

  return { chunkCount: chunks.length };
}
