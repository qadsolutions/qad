import { chunkText } from "@/lib/ingestion/chunking";
import { assertEmbeddingDimensions, createEmbedder } from "@/lib/ingestion/embedder";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type IngestionErrorCode = "no_chunks" | "chunk_insert_failed" | "embedding_insert_failed";

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
 * Chunk `text`, embed each chunk, and bulk-insert `document_chunks` + `embeddings`
 * rows, every row scoped to `tenantId` (issue #25).
 *
 * `tenantId` is always passed in by the caller (the future worker, #26, which
 * already has it from the `documents` row) — never re-derived here, matching
 * the tenant-scoping convention #23 established.
 *
 * Embedding runs before any DB write, so the most common failure (Ollama
 * unreachable) never touches the database. If the embeddings insert fails after
 * the chunks insert already succeeded, the just-inserted chunks are deleted so a
 * failure never leaves orphaned chunks with no vectors.
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

  const chunkRows = textChunks.map((chunk) => ({
    id: crypto.randomUUID(),
    document_id: documentId,
    tenant_id: tenantId,
    chunk_text: chunk.text,
    chunk_index: chunk.index,
    token_count: chunk.tokenCount,
  }));

  const { error: chunksError } = await supabase.from("document_chunks").insert(chunkRows);
  if (chunksError) {
    throw new IngestionError("chunk_insert_failed", chunksError.message);
  }

  const embeddingRows = chunkRows.map((chunk, i) => ({
    chunk_id: chunk.id,
    tenant_id: tenantId,
    embedding: toVectorLiteral(vectors[i]),
    model_version: embedder.modelVersion,
  }));

  const { error: embeddingsError } = await supabase.from("embeddings").insert(embeddingRows);
  if (embeddingsError) {
    await supabase
      .from("document_chunks")
      .delete()
      .in(
        "id",
        chunkRows.map((chunk) => chunk.id),
      );
    throw new IngestionError("embedding_insert_failed", embeddingsError.message);
  }

  return { chunkCount: chunkRows.length };
}
