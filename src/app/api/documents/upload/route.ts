/**
 * POST /api/documents/upload — synchronous half of the ingestion pipeline (issue #23).
 *
 * Per CLAUDE.md "Document Ingestion Pipeline": validate → store raw file → create a
 * `documents` row with status `processing` → return 202 immediately. Chunking/embedding
 * run in a background worker (#26) kicked off via the fire-and-forget {@link triggerIngestion}
 * seam, so this handler stays within the <2s perf target.
 *
 * SECURITY: wrapped in `withTenant` (SECURITY.md §3), so it only runs for a verified
 * token with an active, non-`platform_admin` tenant. Writes go through the service-role
 * client because both the `documents` table and the Storage bucket grant `authenticated`
 * SELECT only (writes are service_role-only by design). Every write is scoped to
 * `tenant.tenantId` — the id from the validated token, never the request body — and the
 * Storage key is `<tenant_id>/<document_id>/<filename>`, the layout the bucket's RLS
 * read policy keys off (20260618000001_storage_documents_bucket.sql).
 */

import { withTenant, type TenantRouteHandler } from "@/lib/auth/with-tenant";
import {
  contentTypeFor,
  MAX_FILE_SIZE_BYTES,
  sanitizeFilename,
  UPLOAD_FIELD_NAME,
  validateUpload,
} from "@/lib/documents/validation";
import { triggerIngestion } from "@/lib/ingestion/trigger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const STORAGE_BUCKET = "documents";

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}

/**
 * Exported for direct unit testing with a mocked context (mirrors `documentsHandler`).
 * The `POST` export below wraps it in `withTenant`.
 */
export const uploadHandler: TenantRouteHandler = async (req, { tenant }) => {
  // Cheap pre-parse guard: reject an over-cap body via Content-Length before buffering
  // the whole multipart payload into memory. The post-parse size check below is the
  // authoritative one (the header is client-supplied and may be absent or wrong).
  const declaredLength = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_SIZE_BYTES) {
    return errorResponse(413, "file_too_large", "File exceeds the 50MB limit");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorResponse(400, "invalid_request", "Expected multipart/form-data with a file field");
  }

  const entry = form.get(UPLOAD_FIELD_NAME);
  const file = entry instanceof File ? entry : null;

  const validation = validateUpload(file && { name: file.name, size: file.size });
  if (!validation.ok) {
    return errorResponse(validation.status, validation.code, validation.message);
  }
  // `file` is non-null here: validateUpload returns !ok for a null file.
  const uploaded = file as File;

  const documentId = crypto.randomUUID();
  const storagePath = `${tenant.tenantId}/${documentId}/${sanitizeFilename(uploaded.name)}`;
  const admin = createSupabaseAdminClient();

  // 1. Store the raw file. `upsert: false` so a generated-uuid collision surfaces as an
  // error rather than silently overwriting another document's bytes.
  const { error: storageError } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, uploaded, {
      contentType: contentTypeFor(validation.fileType, uploaded.type),
      upsert: false,
    });
  if (storageError) {
    return errorResponse(500, "storage_error", "Failed to store the uploaded file");
  }

  // 2. Create the tracking row. tenant_id comes from the validated token; the explicit
  // id matches the Storage path so the row and its bytes are linked from the start.
  const { error: insertError } = await admin.from("documents").insert({
    id: documentId,
    tenant_id: tenant.tenantId,
    filename: uploaded.name,
    file_type: validation.fileType,
    storage_path: storagePath,
    status: "processing",
  });
  if (insertError) {
    // Best-effort cleanup so a failed insert doesn't leave an orphaned object that no
    // row references (and that re-ingestion would never reach).
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return errorResponse(500, "internal_error", "Failed to create the document record");
  }

  // 3. Kick off async processing. Fire-and-forget — never awaited (see triggerIngestion).
  triggerIngestion(documentId);

  // 202 Accepted: the file is stored and tracked, but ingestion is still in progress.
  return Response.json({ document_id: documentId, status: "processing" }, { status: 202 });
};

export const POST = withTenant(uploadHandler);
