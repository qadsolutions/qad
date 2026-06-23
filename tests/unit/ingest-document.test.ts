import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestDocument } from "@/lib/ingestion/ingest-document";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parse } from "@/lib/parsing/parse";
import { DocumentParseError } from "@/lib/parsing/errors";
import { EmbeddingDimensionError } from "@/lib/ingestion/embedder";
import { chunkAndEmbed } from "@/lib/ingestion/chunk-and-embed";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/**
 * Unit tests for the background ingestion worker (issue #26).
 *
 * The admin client, the parser, and the chunk/embed persist step are mocked so
 * the worker's orchestration + status transitions are tested in isolation:
 *   - happy path: status `processing` → `ready`, and download/parse are called
 *     with the loaded row's storage_path / file_type;
 *   - parse / download / chunkAndEmbed / dimension / unsupported-type failures →
 *     status `error` + a code-prefixed error_detail, written after `processing`;
 *   - status updates are tenant-scoped (id + tenant_id) on the happy path;
 *   - a row *read* failure → best-effort `error` (id-scoped, no tenant known);
 *   - document not found → no throw, no status write.
 *
 * The atomic re-ingest RPC and the schema are proven against a real pgvector DB
 * in tests/integration/reingest-atomicity.test.ts.
 */

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/parsing/parse", () => ({ parse: vi.fn() }));
vi.mock("@/lib/ingestion/chunk-and-embed", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ingestion/chunk-and-embed")>(
    "@/lib/ingestion/chunk-and-embed",
  );
  return { ...actual, chunkAndEmbed: vi.fn() };
});

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DOC_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const STORAGE_PATH = `${TENANT_A}/${DOC_A}/handbook.pdf`;

interface MockOpts {
  /** The documents row .maybeSingle() resolves to (null = not found). */
  row?: Record<string, unknown> | null;
  loadError?: unknown;
  downloadError?: unknown;
  updateError?: unknown;
}

/**
 * Mock service-role client supporting the worker's calls:
 *   from("documents").select(...).eq(...).maybeSingle()
 *   from("documents").update(patch).eq("id", id)
 *   storage.from("documents").download(path)
 */
function mockAdmin(opts: MockOpts = {}) {
  const row =
    opts.row === undefined
      ? { tenant_id: TENANT_A, file_type: "pdf", storage_path: STORAGE_PATH, status: "processing" }
      : opts.row;

  const maybeSingle = vi.fn(async () => ({ data: row, error: opts.loadError ?? null }));
  const selectEq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: selectEq }));

  // Records every update patch (in order) and the .eq() filters applied to each. The
  // builder is thenable and its .eq() returns itself, so it supports the worker's
  // chained `.update(patch).eq("id", …).eq("tenant_id", …)`.
  const updatePatches: Array<Record<string, unknown>> = [];
  const updateEqCalls: Array<[string, unknown]> = [];
  const updateResult = { error: opts.updateError ?? null };
  const updateBuilder: Record<string, unknown> = {
    eq: vi.fn((col: string, val: unknown) => {
      updateEqCalls.push([col, val]);
      return updateBuilder;
    }),
    then: (onFulfilled: (v: typeof updateResult) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(updateResult).then(onFulfilled, onRejected),
  };
  const updateEq = updateBuilder.eq as ReturnType<typeof vi.fn>;
  const update = vi.fn((patch: Record<string, unknown>) => {
    updatePatches.push(patch);
    return updateBuilder;
  });

  const from = vi.fn((table: string) => {
    if (table !== "documents") throw new Error(`unexpected table: ${table}`);
    return { select, update };
  });

  const download = vi.fn(async () => ({
    data: opts.downloadError ? null : new Blob([Buffer.from("file bytes")]),
    error: opts.downloadError ?? null,
  }));
  const storageFrom = vi.fn(() => ({ download }));

  const client = { from, storage: { from: storageFrom } } as unknown as TypedSupabaseClient;
  vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
  return {
    from,
    select,
    selectEq,
    update,
    updateEq,
    updateEqCalls,
    updatePatches,
    download,
    storageFrom,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parse).mockResolvedValue({ text: "extracted text" });
  vi.mocked(chunkAndEmbed).mockResolvedValue({ chunkCount: 3 });
});

describe("ingestDocument", () => {
  it("loads the row, downloads + parses with its values, and transitions processing → ready", async () => {
    const admin = mockAdmin();

    await ingestDocument(DOC_A);

    // Download from the documents bucket using the row's storage_path.
    expect(admin.storageFrom).toHaveBeenCalledWith("documents");
    expect(admin.download).toHaveBeenCalledWith(STORAGE_PATH);

    // Parse called with the downloaded bytes (a Buffer) and the row's file_type.
    expect(parse).toHaveBeenCalledTimes(1);
    const [bufArg, typeArg] = vi.mocked(parse).mock.calls[0];
    expect(Buffer.isBuffer(bufArg)).toBe(true);
    expect(typeArg).toBe("pdf");

    expect(chunkAndEmbed).toHaveBeenCalledWith(DOC_A, TENANT_A, "extracted text");

    // First update flips to processing (clearing error_detail); last marks ready.
    expect(admin.updatePatches[0]).toEqual({ status: "processing", error_detail: null });
    expect(admin.updatePatches.at(-1)).toEqual({ status: "ready", error_detail: null });

    // Every status update is scoped by both id and the row's tenant_id (the admin
    // client bypasses RLS, so the tenant filter is the backstop).
    for (const [, val] of admin.updateEqCalls.filter(([col]) => col === "tenant_id")) {
      expect(val).toBe(TENANT_A);
    }
    expect(admin.updateEqCalls.some(([col]) => col === "tenant_id")).toBe(true);
  });

  it("marks status=error with the parse code in error_detail when parsing fails", async () => {
    const admin = mockAdmin();
    vi.mocked(parse).mockRejectedValue(
      new DocumentParseError("corrupt_file", "could not read PDF"),
    );

    await ingestDocument(DOC_A);

    expect(chunkAndEmbed).not.toHaveBeenCalled();
    const last = admin.updatePatches.at(-1) as { status: string; error_detail: string };
    expect(last.status).toBe("error");
    expect(last.error_detail).toContain("corrupt_file");
    expect(last.error_detail).toContain("could not read PDF");
  });

  it("marks status=error when chunkAndEmbed fails", async () => {
    const admin = mockAdmin();
    vi.mocked(chunkAndEmbed).mockRejectedValue(new Error("ollama unreachable"));

    await ingestDocument(DOC_A);

    const last = admin.updatePatches.at(-1) as { status: string; error_detail: string };
    expect(last.status).toBe("error");
    expect(last.error_detail).toContain("ollama unreachable");
  });

  it("writes processing BEFORE error on a failure (not just error last)", async () => {
    // Guards against a regression that skips the opening `processing` write — which is
    // also what clears a previously-failed document's stale error_detail on re-ingest.
    const admin = mockAdmin();
    vi.mocked(chunkAndEmbed).mockRejectedValue(new Error("boom"));

    await ingestDocument(DOC_A);

    expect(admin.updatePatches[0]).toEqual({ status: "processing", error_detail: null });
    expect((admin.updatePatches.at(-1) as { status: string }).status).toBe("error");
  });

  it("marks status=error with the dimension_mismatch code when embedding dims are wrong", async () => {
    const admin = mockAdmin();
    vi.mocked(chunkAndEmbed).mockRejectedValue(
      new EmbeddingDimensionError("Expected 768-dim embedding, got 4"),
    );

    await ingestDocument(DOC_A);

    const last = admin.updatePatches.at(-1) as { status: string; error_detail: string };
    expect(last.status).toBe("error");
    expect(last.error_detail).toContain("dimension_mismatch");
  });

  it("marks status=error for an unsupported file_type without downloading-then-parsing it", async () => {
    const admin = mockAdmin({
      row: { tenant_id: TENANT_A, file_type: "csv", storage_path: STORAGE_PATH },
    });

    await ingestDocument(DOC_A);

    expect(parse).not.toHaveBeenCalled();
    const last = admin.updatePatches.at(-1) as { status: string; error_detail: string };
    expect(last.status).toBe("error");
    expect(last.error_detail).toContain("unsupported_file_type");
  });

  it("marks status=error (id-scoped) when the row read itself fails", async () => {
    // A read failure is distinct from not-found: the row exists, so leaving it at
    // `processing` forever is wrong — the worker best-effort flips it to `error`.
    const admin = mockAdmin({ loadError: { message: "connection reset" } });

    await ingestDocument(DOC_A);

    expect(admin.download).not.toHaveBeenCalled();
    const last = admin.updatePatches.at(-1) as { status: string; error_detail: string };
    expect(last.status).toBe("error");
    expect(last.error_detail).toContain("load_failed");
    // No tenant_id is known on this path, so the update is scoped by id only.
    expect(admin.updateEqCalls.some(([col]) => col === "tenant_id")).toBe(false);
  });

  it("marks status=error when the storage download fails", async () => {
    const admin = mockAdmin({ downloadError: { message: "object not found" } });

    await ingestDocument(DOC_A);

    expect(parse).not.toHaveBeenCalled();
    const last = admin.updatePatches.at(-1) as { status: string };
    expect(last.status).toBe("error");
  });

  it("does not throw and writes no status when the document row is not found", async () => {
    const admin = mockAdmin({ row: null });

    await expect(ingestDocument(DOC_A)).resolves.toBeUndefined();

    expect(admin.update).not.toHaveBeenCalled();
    expect(admin.download).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it("does not throw when even the error-marking update fails (best-effort)", async () => {
    // parse fails AND every update fails — the worker must still resolve, never reject.
    const admin = mockAdmin({ updateError: { message: "db down" } });
    vi.mocked(parse).mockRejectedValue(new DocumentParseError("empty_text", "no text"));

    await expect(ingestDocument(DOC_A)).resolves.toBeUndefined();
    expect(admin.update).toHaveBeenCalled();
  });
});
