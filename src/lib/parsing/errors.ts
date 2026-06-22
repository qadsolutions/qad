/**
 * Typed parse failures for the document ingestion pipeline (issue #24).
 *
 * The future background worker (#26) catches this and flips the document's
 * `status` to `error` (CLAUDE.md "Document Ingestion Pipeline") — the `code`
 * lets it record *why* without parsing a free-text message.
 */
export type ParseErrorCode = "corrupt_file" | "empty_text";

export class DocumentParseError extends Error {
  constructor(
    readonly code: ParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentParseError";
  }
}
