import { beforeEach, describe, expect, it, vi } from "vitest";
import { chunkAndEmbed } from "@/lib/ingestion/chunk-and-embed";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DOC_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** Mock admin client supporting `.from("document_chunks"|"embeddings")`. */
function mockAdmin(
  opts: {
    chunksInsertError?: unknown;
    embeddingsInsertError?: unknown;
    chunksDeleteError?: unknown;
  } = {},
) {
  const chunksInsert = vi.fn(async () => ({ error: opts.chunksInsertError ?? null }));
  const chunksDeleteIn = vi.fn(async () => ({ error: opts.chunksDeleteError ?? null }));
  const chunksDelete = vi.fn(() => ({ in: chunksDeleteIn }));
  const embeddingsInsert = vi.fn(async () => ({ error: opts.embeddingsInsertError ?? null }));

  const from = vi.fn((table: string) => {
    if (table === "document_chunks") {
      return { insert: chunksInsert, delete: chunksDelete };
    }
    if (table === "embeddings") {
      return { insert: embeddingsInsert };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  const client = { from } as unknown as TypedSupabaseClient;
  vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
  return { chunksInsert, chunksDelete, chunksDeleteIn, embeddingsInsert, from };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("INFERENCE_PROVIDER", "mock"); // deterministic fake embedder, no network
});

describe("chunkAndEmbed", () => {
  it("chunks, embeds, and bulk-inserts chunks + embeddings with tenant_id on every row", async () => {
    const admin = mockAdmin();
    const text = "alpha beta gamma delta ".repeat(300); // 3 chunks at default size/overlap

    const result = await chunkAndEmbed(DOC_A, TENANT_A, text);

    expect(result.chunkCount).toBe(3);

    expect(admin.chunksInsert).toHaveBeenCalledTimes(1);
    const chunksInsertArgs = admin.chunksInsert.mock.calls[0] as unknown[];
    const chunkRows = chunksInsertArgs[0] as Array<Record<string, unknown>>;
    expect(chunkRows).toHaveLength(3);
    for (const row of chunkRows) {
      expect(row.document_id).toBe(DOC_A);
      expect(row.tenant_id).toBe(TENANT_A);
    }

    expect(admin.embeddingsInsert).toHaveBeenCalledTimes(1);
    const embeddingsInsertArgs = admin.embeddingsInsert.mock.calls[0] as unknown[];
    const embeddingRows = embeddingsInsertArgs[0] as Array<Record<string, unknown>>;
    expect(embeddingRows).toHaveLength(3);
    for (const [i, row] of embeddingRows.entries()) {
      expect(row.tenant_id).toBe(TENANT_A);
      expect(row.chunk_id).toBe(chunkRows[i].id);
      expect(row.model_version).toBe("mock");
      expect(typeof row.embedding).toBe("string");
      expect(row.embedding as string).toMatch(/^\[[-0-9.,]+\]$/);
    }

    expect(admin.chunksDelete).not.toHaveBeenCalled();
  });

  it("throws IngestionError(no_chunks) for empty text without touching the DB", async () => {
    const admin = mockAdmin();
    await expect(chunkAndEmbed(DOC_A, TENANT_A, "")).rejects.toMatchObject({ code: "no_chunks" });
    expect(admin.chunksInsert).not.toHaveBeenCalled();
  });

  it("throws IngestionError(chunk_insert_failed) and never calls the embeddings insert", async () => {
    const admin = mockAdmin({ chunksInsertError: { message: "constraint violation" } });
    await expect(chunkAndEmbed(DOC_A, TENANT_A, "some real text here")).rejects.toMatchObject({
      code: "chunk_insert_failed",
    });
    expect(admin.embeddingsInsert).not.toHaveBeenCalled();
  });

  it("cleans up the inserted chunks when the embeddings insert fails", async () => {
    const admin = mockAdmin({ embeddingsInsertError: { message: "unique violation" } });
    await expect(chunkAndEmbed(DOC_A, TENANT_A, "some real text here")).rejects.toMatchObject({
      code: "embedding_insert_failed",
    });

    expect(admin.chunksDelete).toHaveBeenCalledTimes(1);
    const chunksInsertArgs = admin.chunksInsert.mock.calls[0] as unknown[];
    const insertedIds = (chunksInsertArgs[0] as Array<{ id: string }>).map((row) => row.id);
    expect(admin.chunksDeleteIn).toHaveBeenCalledExactlyOnceWith("id", insertedIds);
  });

  it("surfaces the cleanup failure in the thrown error when the compensating delete also fails", async () => {
    mockAdmin({
      embeddingsInsertError: { message: "unique violation" },
      chunksDeleteError: { message: "delete blocked by FK" },
    });

    await expect(chunkAndEmbed(DOC_A, TENANT_A, "some real text here")).rejects.toMatchObject({
      code: "embedding_insert_failed",
      message: expect.stringMatching(/unique violation/),
    });
    await expect(chunkAndEmbed(DOC_A, TENANT_A, "some real text here")).rejects.toMatchObject({
      message: expect.stringMatching(/delete blocked by FK/),
    });
  });
});
