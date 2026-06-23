import { beforeEach, describe, expect, it, vi } from "vitest";
import { chunkAndEmbed } from "@/lib/ingestion/chunk-and-embed";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DOC_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/**
 * Mock admin client exposing `.rpc(...)`. Persistence now goes through the single
 * `reingest_document_chunks` RPC (decision D1) rather than two `.from().insert()`
 * calls, so the mock surface is just that one method.
 */
function mockAdmin(opts: { rpcError?: unknown } = {}) {
  const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<unknown>>(async () => ({
    data: opts.rpcError ? null : 0,
    error: opts.rpcError ?? null,
  }));
  const client = { rpc } as unknown as TypedSupabaseClient;
  vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
  return { rpc };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("INFERENCE_PROVIDER", "mock"); // deterministic fake embedder, no network
});

describe("chunkAndEmbed", () => {
  it("chunks, embeds, and persists via the reingest RPC with tenant_id and per-chunk vectors", async () => {
    const admin = mockAdmin();
    const text = "alpha beta gamma delta ".repeat(300); // 3 chunks at default size/overlap

    const result = await chunkAndEmbed(DOC_A, TENANT_A, text);

    expect(result.chunkCount).toBe(3);

    expect(admin.rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = admin.rpc.mock.calls[0];
    expect(fnName).toBe("reingest_document_chunks");
    expect(args.p_document_id).toBe(DOC_A);
    expect(args.p_tenant_id).toBe(TENANT_A);
    expect(args.p_model_version).toBe("mock");

    const chunks = args.p_chunks as Array<Record<string, unknown>>;
    expect(chunks).toHaveLength(3);
    for (const [i, chunk] of chunks.entries()) {
      expect(typeof chunk.id).toBe("string");
      expect(chunk.chunk_index).toBe(i);
      expect(typeof chunk.chunk_text).toBe("string");
      expect(typeof chunk.token_count).toBe("number");
      // pgvector text literal — same shape the embeddings.embedding column ingests.
      expect(chunk.embedding as string).toMatch(/^\[[-0-9.,]+\]$/);
    }
  });

  it("throws IngestionError(no_chunks) for empty text without touching the DB", async () => {
    const admin = mockAdmin();
    await expect(chunkAndEmbed(DOC_A, TENANT_A, "")).rejects.toMatchObject({ code: "no_chunks" });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("throws IngestionError(persist_failed) when the reingest RPC returns an error", async () => {
    const admin = mockAdmin({ rpcError: { message: "duplicate key value violates unique constraint" } });
    await expect(chunkAndEmbed(DOC_A, TENANT_A, "some real text here")).rejects.toMatchObject({
      code: "persist_failed",
      message: expect.stringMatching(/duplicate key/),
    });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });
});
