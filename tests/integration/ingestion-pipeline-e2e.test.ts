import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestDocument } from "@/lib/ingestion/ingest-document";
import type { Embedder } from "@/lib/ingestion/embedder";

/**
 * End-to-end integration coverage for the real ingestion worker (issue #27),
 * against a real pgvector DB — the gap left after #88/#89/#91:
 *   - tests/unit/ingest-document.test.ts proves the worker's orchestration
 *     against a fully-mocked admin client (no real DB, no real parsing/chunking).
 *   - tests/integration/reingest-atomicity.test.ts proves the
 *     `reingest_document_chunks` RPC is atomic, but calls the SQL function
 *     directly, never through `ingestDocument()`.
 *   - tests/integration/chunk-and-embed.test.ts proves the row shapes
 *     `chunkAndEmbed()` builds satisfy the schema, but bypasses
 *     `createSupabaseAdminClient()` entirely.
 *
 * This file drives the actual `ingestDocument()` production entry point against
 * a real schema for AC1 (all 4 file types, end-to-end), AC3 (partial failure
 * recovery), and AC4 (re-ingestion leaves no orphans). AC2 (size-limit +
 * invalid-type rejection) is already fully covered by
 * tests/unit/documents-upload.test.ts and is intentionally not duplicated here.
 *
 * WHY A TEST DOUBLE FOR createSupabaseAdminClient(), NOT THE REAL CLIENT: same
 * blocker documented in chunk-and-embed.test.ts and reingest-atomicity.test.ts —
 * `createSupabaseAdminClient()` returns a real supabase-js client that talks to
 * PostgREST over HTTP, and neither the local test DB nor CI's service container
 * expose a PostgREST endpoint. Every other integration test works around this by
 * writing through the raw `postgres` driver directly instead. `ingestDocument()`
 * and `chunkAndEmbed()` call the admin client directly (no DI seam), so reaching
 * "real worker, real DB" requires a double that implements just the methods they
 * call, backed by the real `postgres` connection used everywhere else in this
 * suite — translating each supabase-js-shaped call into the equivalent raw SQL.
 * This is not a mock of business logic: `ingestDocument()` and `chunkAndEmbed()`
 * run unmodified; only the HTTP transport underneath `createSupabaseAdminClient()`
 * is swapped for a direct DB connection.
 *
 * Storage is faked the same way `setup-test-db.ts` already fakes storage
 * *metadata* (no real byte-storage backend exists here): `.storage.from(...).download()`
 * returns a Blob built from bytes the test itself seeds into an in-memory map,
 * keyed by document id, before calling `ingestDocument()`.
 */

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

const TENANT_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "33333333-3333-3333-3333-000000000001";

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await bootstrapTestDatabase(sql);

  await sql`INSERT INTO auth.users (id, email) VALUES (${USER_ID}, 'usera@e2e-ingest.test')`;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active)
    VALUES (${TENANT_ID}, 'Tenant E2E', 'tenant-e2e-ingest', true)
  `;
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role)
    VALUES (${USER_ID}, ${TENANT_ID}, 'usera@e2e-ingest.test', 'admin')
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

beforeEach(() => {
  vi.stubEnv("INFERENCE_PROVIDER", "mock");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/ingestion/embedder");
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Admin-client double: translates the exact supabase-js-shaped calls
// ingestDocument()/chunkAndEmbed() make into real SQL against `sql`.
// ---------------------------------------------------------------------------

interface DocumentsPatch {
  status: "processing" | "ready" | "error";
  error_detail: string | null;
}

/** The exact payload shape chunkAndEmbed() passes to .rpc("reingest_document_chunks", ...). */
interface ReingestArgs {
  p_document_id: string;
  p_tenant_id: string;
  p_chunks: ReadonlyArray<{
    id: string;
    chunk_text: string;
    chunk_index: number;
    token_count: number;
    embedding: string;
  }>;
  p_model_version: string;
}

/** Bytes the double's fake Storage download() resolves to, keyed by document id. */
function createByteStore() {
  const bytes = new Map<string, Buffer>();
  return {
    seed(documentId: string, content: Buffer): void {
      bytes.set(documentId, content);
    },
    get(documentId: string): Buffer | undefined {
      return bytes.get(documentId);
    },
  };
}

/**
 * Build an admin-client double backed by the real `sql` connection, implementing
 * only what `ingestDocument()` + `chunkAndEmbed()` call:
 *   - from("documents").select(cols).eq("id", id).maybeSingle()
 *   - from("documents").update(patch).eq("id", id)[.eq("tenant_id", id)]
 *   - storage.from("documents").download(path)  (faked via byteStore, path ignored)
 *   - rpc("reingest_document_chunks", args)
 */
function createAdminDouble(byteStore: ReturnType<typeof createByteStore>, documentId: string) {
  const from = vi.fn((table: string) => {
    if (table !== "documents") throw new Error(`admin double: unexpected table ${table}`);

    const select = vi.fn(() => ({
      eq: vi.fn((_col: string, id: string) => ({
        maybeSingle: async () => {
          const rows = await sql`
            SELECT tenant_id, file_type, storage_path
            FROM public.documents
            WHERE id = ${id}
          `;
          return { data: rows[0] ?? null, error: null };
        },
      })),
    }));

    const update = vi.fn((patch: DocumentsPatch) => {
      const filters: Array<[string, string]> = [];
      const builder = {
        eq(col: string, val: string) {
          filters.push([col, val]);
          return builder;
        },
        then(
          onFulfilled: (v: { error: { message: string } | null }) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) {
          return run().then(onFulfilled, onRejected);
        },
      };
      async function run(): Promise<{ error: { message: string } | null }> {
        const idFilter = filters.find(([col]) => col === "id");
        const tenantFilter = filters.find(([col]) => col === "tenant_id");
        if (!idFilter) throw new Error("admin double: update() requires an id filter");
        try {
          if (tenantFilter) {
            await sql`
              UPDATE public.documents
              SET status = ${patch.status}, error_detail = ${patch.error_detail}
              WHERE id = ${idFilter[1]} AND tenant_id = ${tenantFilter[1]}
            `;
          } else {
            await sql`
              UPDATE public.documents
              SET status = ${patch.status}, error_detail = ${patch.error_detail}
              WHERE id = ${idFilter[1]}
            `;
          }
          return { error: null };
        } catch (err) {
          return { error: { message: err instanceof Error ? err.message : String(err) } };
        }
      }
      return builder;
    });

    return { select, update };
  });

  const download = vi.fn(async () => {
    const content = byteStore.get(documentId);
    if (!content) {
      return { data: null, error: { message: "no bytes seeded for this document in test double" } };
    }
    return { data: new Blob([new Uint8Array(content)]), error: null };
  });
  const storageFrom = vi.fn(() => ({ download }));

  const rpc = vi.fn(async (fnName: string, args: ReingestArgs) => {
    if (fnName !== "reingest_document_chunks") {
      throw new Error(`admin double: unexpected rpc ${fnName}`);
    }
    try {
      await sql`
        SELECT public.reingest_document_chunks(
          ${args.p_document_id}::uuid,
          ${args.p_tenant_id}::uuid,
          ${sql.json(args.p_chunks)}::jsonb,
          ${args.p_model_version}::text
        )
      `;
      return { error: null };
    } catch (err) {
      return { error: { message: err instanceof Error ? err.message : String(err) } };
    }
  });

  return { from, storage: { from: storageFrom }, rpc };
}

// ---------------------------------------------------------------------------
// DB query helpers
// ---------------------------------------------------------------------------

async function insertProcessingDocument(opts: {
  id: string;
  filename: string;
  fileType: string;
}): Promise<void> {
  const storagePath = `${TENANT_ID}/${opts.id}/${opts.filename}`;
  await sql`
    INSERT INTO public.documents (id, tenant_id, filename, file_type, storage_path, status)
    VALUES (${opts.id}, ${TENANT_ID}, ${opts.filename}, ${opts.fileType}, ${storagePath}, 'processing')
  `;
}

async function getDocumentStatus(
  documentId: string,
): Promise<{ status: string; error_detail: string | null }> {
  const rows = await sql`
    SELECT status, error_detail FROM public.documents WHERE id = ${documentId}
  `;
  return rows[0] as { status: string; error_detail: string | null };
}

async function getChunks(
  documentId: string,
): Promise<Array<{ id: string; chunk_index: number }>> {
  const rows = await sql`
    SELECT id, chunk_index FROM public.document_chunks
    WHERE document_id = ${documentId}
    ORDER BY chunk_index
  `;
  return rows as unknown as Array<{ id: string; chunk_index: number }>;
}

async function getEmbeddingsForDocument(
  documentId: string,
): Promise<Array<{ chunk_id: string; tenant_id: string; dims: number }>> {
  const rows = await sql`
    SELECT e.chunk_id, e.tenant_id, vector_dims(e.embedding) AS dims
    FROM public.embeddings e
    JOIN public.document_chunks c ON c.id = e.chunk_id
    WHERE c.document_id = ${documentId}
  `;
  return rows as unknown as Array<{ chunk_id: string; tenant_id: string; dims: number }>;
}

async function countOrphanedEmbeddings(): Promise<number> {
  const rows = await sql`
    SELECT count(*)::int AS n FROM public.embeddings e
    WHERE e.tenant_id = ${TENANT_ID}
      AND NOT EXISTS (SELECT 1 FROM public.document_chunks c WHERE c.id = e.chunk_id)
  `;
  return rows[0].n as number;
}

const FIXTURES_DIR = resolve(process.cwd(), "tests/fixtures");

describe("ingestDocument() end-to-end against a real pgvector DB (#27)", () => {
  // -------------------------------------------------------------------------
  // AC1: all four file types ingest end-to-end through the real worker.
  // -------------------------------------------------------------------------
  describe.each([
    { fileType: "pdf", filename: "handbook.pdf", bytes: () => readFileSync(resolve(FIXTURES_DIR, "sample.pdf")) },
    { fileType: "docx", filename: "handbook.docx", bytes: () => readFileSync(resolve(FIXTURES_DIR, "sample.docx")) },
    {
      fileType: "txt",
      filename: "notes.txt",
      bytes: () => Buffer.from("Synthetic onboarding notes for the QAD test suite. ".repeat(20), "utf-8"),
    },
    {
      fileType: "md",
      filename: "notes.md",
      bytes: () => Buffer.from("# Synthetic Notes\n\nSome **markdown** content. ".repeat(20), "utf-8"),
    },
  ])("file type: $fileType", ({ fileType, filename, bytes }) => {
    it(`ingests a real .${fileType} fixture end-to-end: status ready, chunks + 768-dim embeddings persisted`, async () => {
      const documentId = crypto.randomUUID();
      await insertProcessingDocument({ id: documentId, filename, fileType });

      const byteStore = createByteStore();
      byteStore.seed(documentId, bytes());
      const admin = createAdminDouble(byteStore, documentId);
      vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);

      await ingestDocument(documentId);

      const doc = await getDocumentStatus(documentId);
      expect(doc.status).toBe("ready");
      expect(doc.error_detail).toBeNull();

      const chunks = await getChunks(documentId);
      expect(chunks.length).toBeGreaterThan(0);

      const embeddings = await getEmbeddingsForDocument(documentId);
      expect(embeddings).toHaveLength(chunks.length);
      for (const row of embeddings) {
        expect(row.dims).toBe(768);
        expect(row.tenant_id).toBe(TENANT_ID);
      }
    });
  });

  // -------------------------------------------------------------------------
  // AC3: partial failure recovery — embed fails mid-pipeline -> status error,
  // no partial chunks left.
  // -------------------------------------------------------------------------
  describe("partial failure recovery (AC3)", () => {
    it("a first-time ingest whose embedding step fails ends at status=error with zero chunks persisted", async () => {
      const documentId = crypto.randomUUID();
      await insertProcessingDocument({ id: documentId, filename: "fails.txt", fileType: "txt" });

      const byteStore = createByteStore();
      byteStore.seed(documentId, Buffer.from("Some real text content to chunk and embed.", "utf-8"));
      const admin = createAdminDouble(byteStore, documentId);
      vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);

      // Force the embed step to fail by making createEmbedder() return an embedder
      // whose embed() rejects — this is the most common real-world failure mode
      // (Ollama unreachable / request error), and chunkAndEmbed() never writes to
      // the DB before this call succeeds (see chunk-and-embed.ts's header comment).
      vi.doMock("@/lib/ingestion/embedder", async () => {
        const actual =
          await vi.importActual<typeof import("@/lib/ingestion/embedder")>(
            "@/lib/ingestion/embedder",
          );
        return {
          ...actual,
          createEmbedder: (): Embedder => ({
            modelVersion: "mock",
            embed: async () => {
              throw new Error("embedding backend unreachable (simulated)");
            },
          }),
        };
      });
      vi.resetModules();
      const { ingestDocument: ingestDocumentWithFailingEmbedder } = await import(
        "@/lib/ingestion/ingest-document"
      );

      await ingestDocumentWithFailingEmbedder(documentId);

      const doc = await getDocumentStatus(documentId);
      expect(doc.status).toBe("error");
      expect(doc.error_detail).toBeTruthy();
      expect(doc.error_detail).toContain("embedding backend unreachable");

      // The RPC is never invoked (embedding happens before any DB write), so no
      // chunks or embeddings exist for this document at all.
      expect(await getChunks(documentId)).toHaveLength(0);
      expect(await getEmbeddingsForDocument(documentId)).toHaveLength(0);
    });

    it("a wrong-dimension embedding also ends at status=error with zero chunks persisted", async () => {
      const documentId = crypto.randomUUID();
      await insertProcessingDocument({ id: documentId, filename: "baddim.txt", fileType: "txt" });

      const byteStore = createByteStore();
      byteStore.seed(documentId, Buffer.from("Text that will get a malformed embedding.", "utf-8"));
      const admin = createAdminDouble(byteStore, documentId);
      vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);

      vi.doMock("@/lib/ingestion/embedder", async () => {
        const actual =
          await vi.importActual<typeof import("@/lib/ingestion/embedder")>(
            "@/lib/ingestion/embedder",
          );
        return {
          ...actual,
          createEmbedder: (): Embedder => ({
            modelVersion: "mock",
            // Wrong dimensionality — assertEmbeddingDimensions() inside
            // chunkAndEmbed() throws before any DB write is attempted.
            embed: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
          }),
        };
      });
      vi.resetModules();
      const { ingestDocument: ingestDocumentWithBadDims } = await import(
        "@/lib/ingestion/ingest-document"
      );

      await ingestDocumentWithBadDims(documentId);

      const doc = await getDocumentStatus(documentId);
      expect(doc.status).toBe("error");
      expect(doc.error_detail).toContain("dimension_mismatch");
      expect(await getChunks(documentId)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // AC4: re-ingestion leaves no orphaned chunks/embeddings, exercised through
  // the real worker (not just the raw RPC, which reingest-atomicity.test.ts
  // already covers).
  // -------------------------------------------------------------------------
  describe("re-ingestion leaves no orphans (AC4)", () => {
    it("re-ingesting the same document replaces all chunks + embeddings with zero orphans", async () => {
      const documentId = crypto.randomUUID();
      await insertProcessingDocument({ id: documentId, filename: "versioned.txt", fileType: "txt" });

      const byteStore = createByteStore();
      const admin = createAdminDouble(byteStore, documentId);
      vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);

      // First ingest.
      byteStore.seed(
        documentId,
        Buffer.from("Original content version one. ".repeat(40), "utf-8"),
      );
      await ingestDocument(documentId);

      const firstDoc = await getDocumentStatus(documentId);
      expect(firstDoc.status).toBe("ready");
      const firstChunks = await getChunks(documentId);
      expect(firstChunks.length).toBeGreaterThan(0);
      const firstChunkIds = new Set(firstChunks.map((c) => c.id));

      // Re-ingest with different content (different chunk count is fine — the
      // RPC replaces the full set regardless of size).
      byteStore.seed(
        documentId,
        Buffer.from("Completely different content for version two only. ".repeat(60), "utf-8"),
      );
      await ingestDocument(documentId);

      const secondDoc = await getDocumentStatus(documentId);
      expect(secondDoc.status).toBe("ready");
      expect(secondDoc.error_detail).toBeNull();

      const secondChunks = await getChunks(documentId);
      expect(secondChunks.length).toBeGreaterThan(0);
      const secondChunkIds = new Set(secondChunks.map((c) => c.id));

      // Original chunk ids are completely gone; only the new set remains.
      for (const id of firstChunkIds) {
        expect(secondChunkIds.has(id)).toBe(false);
      }

      const embeddings = await getEmbeddingsForDocument(documentId);
      expect(embeddings).toHaveLength(secondChunks.length);

      // No embedding rows survive that no longer point at a current chunk.
      expect(await countOrphanedEmbeddings()).toBe(0);
    });

    it("re-ingestion after a failed first attempt still lands cleanly with no leftover rows", async () => {
      const documentId = crypto.randomUUID();
      await insertProcessingDocument({ id: documentId, filename: "recover.txt", fileType: "txt" });

      const byteStore = createByteStore();
      const admin = createAdminDouble(byteStore, documentId);
      vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);

      // First attempt fails at parse time (empty text -> DocumentParseError).
      byteStore.seed(documentId, Buffer.from("   \n\t  ", "utf-8"));
      await ingestDocument(documentId);
      const failedDoc = await getDocumentStatus(documentId);
      expect(failedDoc.status).toBe("error");
      expect(await getChunks(documentId)).toHaveLength(0);

      // Re-ingest with real content succeeds and clears error_detail.
      byteStore.seed(documentId, Buffer.from("Now there is real content to ingest. ".repeat(30), "utf-8"));
      await ingestDocument(documentId);

      const recoveredDoc = await getDocumentStatus(documentId);
      expect(recoveredDoc.status).toBe("ready");
      expect(recoveredDoc.error_detail).toBeNull();
      expect((await getChunks(documentId)).length).toBeGreaterThan(0);
      expect(await countOrphanedEmbeddings()).toBe(0);
    });
  });
});
