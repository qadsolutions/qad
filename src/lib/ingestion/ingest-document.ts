import { chunkAndEmbed, IngestionError } from "@/lib/ingestion/chunk-and-embed";
import { EmbeddingDimensionError } from "@/lib/ingestion/embedder";
import { DocumentParseError } from "@/lib/parsing/errors";
import { parse } from "@/lib/parsing/parse";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isFileType } from "@/lib/documents/validation";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The subset of `document_status` this worker ever writes. Derived from the generated
 * `document_status` enum (#92) rather than hand-declared, so it can't silently drift
 * from the DB's allowed set — `Exclude<..., "uploading">` because `uploading` is only
 * ever the column's insert-time default (set by the upload route, #23), never written
 * by this worker.
 */
type WorkerDocumentStatus = Exclude<
  Database["public"]["Enums"]["document_status"],
  "uploading"
>;

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
 * A genuinely missing row (e.g. deleted between upload and this running) is logged and
 * ignored — there is nothing to mark. A *read failure* of an existing row is different:
 * it is marked `error` best-effort so the document doesn't sit at `processing` forever.
 */
export async function ingestDocument(documentId: string): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { data: doc, error: loadError } = await admin
    .from("documents")
    .select("tenant_id, file_type, storage_path")
    .eq("id", documentId)
    .maybeSingle();

  if (loadError) {
    // The row exists (the upload route just inserted it at `processing`) but the read
    // failed — distinct from "not found". Without marking it the document would sit at
    // `processing` forever with no signal, so best-effort flip it to `error`. We have no
    // tenant_id here (the load failed), so this update is scoped by id only.
    console.error(`[ingestion] failed to load document ${documentId}: ${loadError.message}`);
    await markErrorBestEffort(admin, documentId, undefined, `load_failed: ${loadError.message}`);
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
    await updateStatus(admin, documentId, tenantId, { status: "processing", error_detail: null });

    const blob = await downloadBytes(admin, doc.storage_path);
    const buffer = Buffer.from(await blob.arrayBuffer());

    // file_type is DB-enforced (document_file_type enum, #92); isFileType() still
    // re-validates at runtime — see its doc comment for why.
    const fileType = doc.file_type;
    if (!isFileType(fileType)) {
      throw new Error(`unsupported_file_type: '${fileType}'`);
    }

    const { text } = await parse(buffer, fileType);
    await chunkAndEmbed(documentId, tenantId, text);

    await updateStatus(admin, documentId, tenantId, { status: "ready", error_detail: null });
  } catch (err) {
    const detail = describeFailure(err);
    console.error(`[ingestion] document ${documentId} (tenant ${tenantId}) failed: ${detail}`);
    await markErrorBestEffort(admin, documentId, tenantId, detail);
  }
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Update a document's status (+ error_detail). Throws on a DB error so callers can react.
 * Scoped by tenant_id as well as id when known — the admin client bypasses RLS, so the
 * tenant filter is the backstop that keeps a write pinned to the document's own tenant
 * (the repo's "DB-as-backstop-for-service_role-writes" convention). `tenantId` is
 * `undefined` only on the load-error path, where the row couldn't be read to learn it.
 */
async function updateStatus(
  admin: AdminClient,
  documentId: string,
  tenantId: string | undefined,
  patch: { status: WorkerDocumentStatus; error_detail: string | null },
): Promise<void> {
  let query = admin.from("documents").update(patch).eq("id", documentId);
  if (tenantId !== undefined) {
    query = query.eq("tenant_id", tenantId);
  }
  const { error } = await query;
  if (error) {
    throw new Error(`status update to '${patch.status}' failed: ${error.message}`);
  }
}

/**
 * Record status='error' + detail without letting a secondary failure escape. The worker
 * is detached (fire-and-forget), so an escaping rejection would be an unhandled rejection;
 * if even this update fails there is nowhere left to surface it but the log.
 */
async function markErrorBestEffort(
  admin: AdminClient,
  documentId: string,
  tenantId: string | undefined,
  detail: string,
): Promise<void> {
  try {
    await updateStatus(admin, documentId, tenantId, { status: "error", error_detail: detail });
  } catch (markErr) {
    console.error(
      `[ingestion] document ${documentId}: also failed to mark status=error: ${String(markErr)}`,
    );
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
 * A concise, durable failure message. Every typed pipeline error carries a stable
 * `code` (e.g. `corrupt_file`, `no_chunks`, `dimension_mismatch`), prefixed here so the
 * admin dashboard can show a stable reason rather than only free text.
 */
function describeFailure(err: unknown): string {
  if (
    err instanceof DocumentParseError ||
    err instanceof IngestionError ||
    err instanceof EmbeddingDimensionError
  ) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
