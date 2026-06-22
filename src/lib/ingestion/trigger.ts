import { ingestDocument } from "@/lib/ingestion/ingest-document";

/**
 * Ingestion trigger seam (issues #23, #26).
 *
 * The upload endpoint calls this immediately after persisting the `documents` row, to
 * kick off the async chunk → embed → pgvector pipeline (CLAUDE.md "Document Ingestion
 * Pipeline"). It invokes the background worker {@link ingestDocument} and returns
 * right away.
 *
 * Fire-and-forget by contract: the upload route must NOT await this on the request path
 * — the 202 response has a <2s perf target (CLAUDE.md "Performance Targets"). The
 * document sits at status `processing` until the worker finishes (status `ready`) or
 * marks it `error`. The worker handles its own failures and records them on the row, so
 * the only thing this seam must guarantee is that a rejected promise can never surface
 * as an unhandled rejection — hence the `.catch()` below (the worker is designed not to
 * reject, this is a defensive backstop).
 */
export function triggerIngestion(documentId: string): void {
  void ingestDocument(documentId).catch((err: unknown) => {
    console.error(`[ingestion] unexpected worker rejection for document ${documentId}:`, err);
  });
}
