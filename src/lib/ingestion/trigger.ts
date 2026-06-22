/**
 * Ingestion trigger seam (issue #23).
 *
 * The upload endpoint calls this immediately after persisting the `documents` row, to
 * kick off the async chunk → embed → pgvector pipeline (CLAUDE.md "Document Ingestion
 * Pipeline"). The real background worker — `ingestDocument(documentId)` per the M3 plan's
 * Wave 0 interface — lands in #26, with the embedder from #25.
 *
 * Until then this is a deliberate no-op seam: it gives the upload path a single,
 * well-named place for #26 to wire the worker without touching the route, and keeps #23
 * shippable independently of #25/#26.
 *
 * Fire-and-forget by contract: the upload route must NOT await this on the request path
 * — the 202 response has a <2s perf target (CLAUDE.md "Performance Targets"). A document
 * sits at status `processing` until the worker finishes (or marks it `error`).
 */
export function triggerIngestion(documentId: string): void {
  // #26 replaces this body with the real enqueue / worker invocation.
  // Structured logging lands with the monitoring sink in M9 (#75); a console marker is
  // enough to confirm the seam fires during local dev until then.
  console.info(`[ingestion] queued document ${documentId} (background worker arrives in #26)`);
}
