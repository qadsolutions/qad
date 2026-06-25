import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestDocument } from "@/lib/ingestion/ingest-document";
import type { Embedder } from "@/lib/ingestion/embedder";
import type { Database } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

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

// Anchor the double's data shapes to the schema-generated source of truth, so a real
// column rename / type change (or RPC signature change) breaks compilation here instead
// of drifting silently. When PR #95 regenerates database.types.ts with the real status
// enum, `status` below automatically tightens from `string` to the literal union — no
// further change needed here.
type DocumentsPatch = Required<
  Pick<Database["public"]["Tables"]["documents"]["Update"], "status" | "error_detail">
>;

/** Extends the real generated RPC arg type, keeping a stricter `p_chunks` element shape. */
type RealReingestArgs = Database["public"]["Functions"]["reingest_document_chunks"]["Args"];
interface ReingestArgs extends Omit<RealReingestArgs, "p_chunks"> {
  p_chunks: ReadonlyArray<{
    id: string;
    chunk_text: string;
    chunk_index: number;
    token_count: number;
    embedding: string;
  }>;
}

/**
 * Faithfully reproduce the parts of a real Supabase `PostgrestError` callers may branch
 * on. The `postgres` npm driver's thrown errors carry `.code`, `.detail` (singular),
 * `.hint` when available; map them into PostgrestError's `{message, details, hint, code}`
 * shape so the double's error object is realistic for any future caller. Production code
 * (ingest-document.ts / chunk-and-embed.ts) only reads `.message` today.
 */
function toPostgrestErrorShape(err: unknown): {
  message: string;
  details: string | null;
  hint: string | null;
  code: string | null;
} {
  if (err instanceof Error) {
    const pgErr = err as Error & { detail?: string; hint?: string; code?: string };
    return {
      message: pgErr.message,
      details: pgErr.detail ?? null,
      hint: pgErr.hint ?? null,
      code: pgErr.code ?? null,
    };
  }
  return { message: String(err), details: null, hint: null, code: null };
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
 *   - from("documents").update(patch).eq("id", id).eq("tenant_id", id)
 *   - storage.from("documents").download(path)  (faked via byteStore, path ignored)
 *   - rpc("reingest_document_chunks", args)
 *
 * `opts.forceUpdateError` makes every update() call resolve with a DB error (without
 * touching `sql`), so tests can exercise the worker's write-failure branches.
 */
function createAdminDouble(
  byteStore: ReturnType<typeof createByteStore>,
  documentId: string,
  opts: { forceUpdateError?: boolean } = {},
) {
  const forceUpdateError = opts.forceUpdateError ?? false;
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
          if (col !== "id" && col !== "tenant_id") {
            throw new Error(`admin double: update() got unsupported filter column '${col}'`);
          }
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
        if (!tenantFilter) {
          throw new Error(
            "admin double: update() was called without a tenant_id filter — " +
              "ingest-document.ts's updateStatus() must always scope writes by tenant_id " +
              "once the document has loaded; if you're intentionally testing the documented " +
              "load-error path (no tenantId available), extend this double to support it explicitly " +
              "instead of silently falling back to an id-only write.",
          );
        }
        if (forceUpdateError) {
          return { error: { message: "simulated DB write failure (forceUpdateError)" } };
        }
        try {
          await sql`
            UPDATE public.documents
            SET status = ${patch.status}, error_detail = ${patch.error_detail}
            WHERE id = ${idFilter[1]} AND tenant_id = ${tenantFilter[1]}
          `;
          return { error: null };
        } catch (err) {
          return { error: toPostgrestErrorShape(err) };
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
      return { error: toPostgrestErrorShape(err) };
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

// ---------------------------------------------------------------------------
// Per-case setup helpers
// ---------------------------------------------------------------------------

/**
 * Generate a document id, insert a `processing` row, build the byte store + admin
 * double, and wire the `createSupabaseAdminClient` mock — the boilerplate every case
 * repeats. Pass `bytes` to seed the store at setup time; omit it (and seed later via
 * the returned `byteStore`) for cases that need different content per ingest.
 */
async function setupIngestCase(opts: {
  filename: string;
  fileType: string;
  bytes?: Buffer;
  forceUpdateError?: boolean;
}): Promise<{ documentId: string; byteStore: ReturnType<typeof createByteStore> }> {
  const documentId = crypto.randomUUID();
  await insertProcessingDocument({ id: documentId, filename: opts.filename, fileType: opts.fileType });
  const byteStore = createByteStore();
  if (opts.bytes) byteStore.seed(documentId, opts.bytes);
  const admin = createAdminDouble(byteStore, documentId, { forceUpdateError: opts.forceUpdateError });
  vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as unknown as TypedSupabaseClient);
  return { documentId, byteStore };
}

/**
 * Re-import `ingestDocument` with `createEmbedder()` swapped for one whose `embed()` is
 * the supplied implementation — the ~18-line `vi.doMock`/`vi.resetModules`/dynamic-import
 * dance both AC3 partial-failure cases otherwise repeat.
 */
async function importIngestDocumentWithEmbedder(
  embed: Embedder["embed"],
): Promise<(typeof import("@/lib/ingestion/ingest-document"))["ingestDocument"]> {
  vi.doMock("@/lib/ingestion/embedder", async () => {
    const actual = await vi.importActual<typeof import("@/lib/ingestion/embedder")>(
      "@/lib/ingestion/embedder",
    );
    return { ...actual, createEmbedder: (): Embedder => ({ modelVersion: "mock", embed }) };
  });
  vi.resetModules();
  const { ingestDocument } = await import("@/lib/ingestion/ingest-document");
  return ingestDocument;
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
      const { documentId } = await setupIngestCase({ filename, fileType, bytes: bytes() });

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
      const { documentId } = await setupIngestCase({
        filename: "fails.txt",
        fileType: "txt",
        bytes: Buffer.from("Some real text content to chunk and embed.", "utf-8"),
      });

      // Force the embed step to fail — this is the most common real-world failure mode
      // (Ollama unreachable / request error), and chunkAndEmbed() never writes to the DB
      // before this call succeeds (see chunk-and-embed.ts's header comment).
      const ingestDocumentWithFailingEmbedder = await importIngestDocumentWithEmbedder(
        async () => {
          throw new Error("embedding backend unreachable (simulated)");
        },
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
      const { documentId } = await setupIngestCase({
        filename: "baddim.txt",
        fileType: "txt",
        bytes: Buffer.from("Text that will get a malformed embedding.", "utf-8"),
      });

      // Wrong dimensionality — assertEmbeddingDimensions() inside chunkAndEmbed() throws
      // before any DB write is attempted.
      const ingestDocumentWithBadDims = await importIngestDocumentWithEmbedder(
        async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
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
      const { documentId, byteStore } = await setupIngestCase({
        filename: "versioned.txt",
        fileType: "txt",
      });

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
      const { documentId, byteStore } = await setupIngestCase({
        filename: "recover.txt",
        fileType: "txt",
      });

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

  // -------------------------------------------------------------------------
  // DB write-failure handling: updateStatus()/markErrorBestEffort()'s error
  // branches in ingest-document.ts, otherwise unexercised by this suite.
  // -------------------------------------------------------------------------
  describe("DB write failure handling", () => {
    it("a DB write failure on every update() call is caught and logged, never escaping ingestDocument() as a rejection", async () => {
      const { documentId } = await setupIngestCase({
        filename: "dbfail.txt",
        fileType: "txt",
        bytes: Buffer.from("Real content that would parse and embed fine.", "utf-8"),
        forceUpdateError: true,
      });

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(ingestDocument(documentId)).resolves.toBeUndefined();

      // updateStatus()'s first call (marking 'processing') fails -> caught by
      // ingestDocument()'s try/catch -> markErrorBestEffort() tries to mark
      // status='error' -> that update ALSO fails (every update() call fails here) ->
      // markErrorBestEffort()'s own catch must log, not throw. This is the
      // doubly-nested failure path that was previously completely untested.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("also failed to mark status=error"),
      );

      errorSpy.mockRestore();
    });
  });
});
