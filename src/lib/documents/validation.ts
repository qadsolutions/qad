import type { Database } from "@/lib/supabase/database.types";

/**
 * Upload validation for the document ingestion pipeline (issue #23).
 *
 * Pure, dependency-free helpers so the rules (allowed types, size cap) are unit-testable
 * in isolation and shared by the route. Mirrors CLAUDE.md "Document Ingestion Pipeline":
 * accept PDF, DOCX, TXT, MD up to 50MB.
 */

/** Max raw upload size: 50MB (CLAUDE.md ingestion pipeline). */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Multipart form field name the upload endpoint reads the file from. */
export const UPLOAD_FIELD_NAME = "file";

/**
 * Canonical `file_type` stored on the `documents` row and later switched on by the
 * parsers (#24). Derived from the generated `document_file_type` Postgres enum (#92)
 * instead of a hand-declared union, so this type can never silently drift from the
 * DB's allowed set — the schema is the single source of truth for the four values.
 */
export type FileType = Database["public"]["Enums"]["document_file_type"];

/**
 * Allowed extension → canonical `FileType`. Extension is the reliable signal across
 * these formats (a browser's MIME for .md/.txt is unreliable), so type is keyed off
 * it. The extension→type mapping itself is NOT a DB concern (file extensions are
 * never stored or constrained by the schema), so unlike `FileType` above this stays a
 * local table — just typed against the DB-derived `FileType` so a typo here would be
 * a compile error rather than a silently-accepted bogus value.
 */
const ALLOWED_EXTENSIONS = {
  pdf: "pdf",
  docx: "docx",
  txt: "txt",
  md: "md",
} as const satisfies Record<string, FileType>;

/** Fallback content types for Storage when the browser sends none, keyed by file_type. */
const CONTENT_TYPE_BY_FILE_TYPE: Record<FileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};

/**
 * Re-validate a value that the generated DB types already nominally type as
 * `FileType` (e.g. `documents.file_type`) against the canonical runtime set. This
 * guards against the generated types being stale relative to the live schema, or an
 * out-of-band write reaching this code path with a value outside the four allowed —
 * defense-in-depth, not the only thing standing between a bad value and the parser's
 * exhaustive switch, now that `document_file_type` is also a DB-enforced enum (#92).
 */
export function isFileType(value: string): value is FileType {
  return Object.hasOwn(ALLOWED_EXTENSIONS, value);
}

/** Resolve the canonical `file_type` from a filename, or null if the extension isn't allowed. */
export function resolveFileType(filename: string): FileType | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return ALLOWED_EXTENSIONS[ext as keyof typeof ALLOWED_EXTENSIONS] ?? null;
}

/** Content type to persist to Storage: prefer the browser's, else map from file_type. */
export function contentTypeFor(fileType: FileType, providedType?: string): string {
  return providedType && providedType.length > 0
    ? providedType
    : CONTENT_TYPE_BY_FILE_TYPE[fileType];
}

/** A validation failure mapped to the HTTP status and error code the route returns. */
export interface UploadValidationError {
  ok: false;
  status: 400 | 413 | 415;
  code: "missing_file" | "empty_file" | "unsupported_file_type" | "file_too_large";
  message: string;
}

export interface UploadValidationOk {
  ok: true;
  fileType: FileType;
}

/**
 * Validate an uploaded file's presence, extension, and size. Pure: takes only the
 * metadata it needs so it can be tested without constructing a real File/Request.
 */
export function validateUpload(file: {
  name: string;
  size: number;
} | null): UploadValidationOk | UploadValidationError {
  if (!file) {
    return { ok: false, status: 400, code: "missing_file", message: "No file provided" };
  }

  const fileType = resolveFileType(file.name);
  if (!fileType) {
    return {
      ok: false,
      status: 415,
      code: "unsupported_file_type",
      message: "Unsupported file type. Allowed: PDF, DOCX, TXT, MD",
    };
  }

  if (file.size <= 0) {
    return { ok: false, status: 400, code: "empty_file", message: "File is empty" };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      status: 413,
      code: "file_too_large",
      message: "File exceeds the 50MB limit",
    };
  }

  return { ok: true, fileType };
}

/**
 * Reduce an uploaded filename to a safe storage path segment: basename only (drop any
 * directory components a client may have sent) with disallowed characters collapsed to
 * `_`. The original filename is still stored verbatim in `documents.filename` for
 * display; this only sanitizes what goes into the Storage object key. Tenant isolation
 * does not depend on this (the path's first segment is always the tenant_id), but it
 * keeps object keys predictable and free of traversal-looking segments.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : "file";
}
