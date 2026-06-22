import { chunkAndEmbed, IngestionError } from "@/lib/ingestion/chunk-and-embed";
import { EmbeddingDimensionError } from "@/lib/ingestion/embedder";
import { DocumentParseError } from "@/lib/parsing/errors";
import { parse } from "@/lib/parsing/parse";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { FileType } from "@/lib/documents/validation";

/**
 * The document-ingestion background worker (issue #26).
 *
 * This is the async half of the pipeline (CLAUDE.md "Document Ingestion
 * Pipeline"): the upload route persists a `documents` row at status `processing`,
 * returns 202, and fires {@link triggerIngestion}, which calls this. By contract
 * this runs detached from the request — it must never be awaited on the upload
 * path (the 202 has a <2s perf target), so its only externally-visible result is
 * the document's `status` (and, on failure, `error_detail`) transitioning in the
 * row.
 *
 * Flow: load the row → mark `processing` (and clear any stale `error_detail`,
 * which matters for re-ingestion of a previously-`ready`/`error` document) →
 * download the raw bytes from Storage → parse to text → chunk + embed + persist
 * (atomic re-ingest, decision D1) → mark `ready`.
 *
 * FAILURE HANDLING. Any error after the row is loaded is caught and recorded
 * durably as `status='error'` + a concise `error_detail` (decision: error detail
 * is a column, visible to the future M7 admin dashboard, not just a log line) and
 * also logged. The persistence step is atomic, so a failure there leaves the
 * document's prior chunks/embeddings intact — the row flips to `error` with the
 * old data untouched, never half-wiped. The error-marking update is itself
 * best-effort: the worker never throws out of its own body (a detached rejection
 * has nowhere to go), so a failure to even record the error is logged, not raised.
 *
 * A missing document row (e.g. deleted between upload and this running) is logged
 * and ignored — there is nothing to mark.
 */
export async function ingestDocument(documentId: string): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { data: doc, error: loadError } = await admin
    .from("documents")
    .select("tenant_id, file_type, storage_path, status")
    .eq("id", documentId)
    .maybeSingle();

  if (loadError) {
    console.error(
      `[ingestion] failed to load document ${documentId}: ${loadError.message}`,
    );
    return;
  }
  if (!doc) {
    console.error(`[ingestion] document ${documentId} not found — nothing to ingest`);
    return;
  }

  const tenantId = doc.tenant_id;

  try {
    // Mark processing and clear any prior error_detail. Covers re-ingestion: a
    // document that was `ready` or `error` is moved back to `processing` for this run.
    await updateStatus(admin, documentId, { status: "processing", error_detail: null });

    const blob = await downloadBytes(admin, doc.storage_path);
    const buffer = Buffer.from(await blob.arrayBuffer());

    const { text } = await parse(buffer, doc.file_type as FileType);
    await chunkAndEmbed(documentId, tenantId, text);

    await updateStatus(admin, documentId, { status: "ready", error_detail: null });
  } catch (err) {
    const detail = describeFailure(err);
    console.error(
      `[ingestion] document ${documentId} (tenant ${tenantId}) failed: ${detail}`,
    );
    // Best-effort: record the failure durably for the admin dashboard. Never rethrow —
    // the worker is detached, so an escaping rejection would be an unhandled rejection.
    try {
      await updateStatus(admin, documentId, { status: "error", error_detail: detail });
    } catch (markErr) {
      console.error(
        `[ingestion] document ${documentId}: also failed to mark status=error: ${String(markErr)}`,
      );
    }
  }
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** Update a document's status (+ error_detail). Throws on a DB error so callers can react. */
async function updateStatus(
  admin: AdminClient,
  documentId: string,
  patch: { status: "processing" | "ready" | "error"; error_detail: string | null },
): Promise<void> {
  const { error } = await admin.from("documents").update(patch).eq("id", documentId);
  if (error) {
    throw new Error(`status update to '${patch.status}' failed: ${error.message}`);
  }
}

/** Download the raw document bytes from the `documents` Storage bucket. */
async function downloadBytes(admin: AdminClient, storagePath: string): Promise<Blob> {
  const { data, error } = await admin.storage.from("documents").download(storagePath);
  if (error || !data) {
    throw new Error(
      `failed to download ${storagePath} from storage: ${error?.message ?? "no data returned"}`,
    );
  }
  return data;
}

/**
 * A concise, durable failure message. For the pipeline's typed errors the `code`
 * is prefixed so the admin dashboard can show a stable reason (e.g. `corrupt_file`,
 * `no_chunks`) rather than only free text.
 */
function describeFailure(err: unknown): string {
  if (
    err instanceof DocumentParseError ||
    err instanceof IngestionError ||
    err instanceof EmbeddingDimensionError
  ) {
    const code = "code" in err ? err.code : err.name;
    return `${code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
