import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIM } from "@/lib/ingestion/embedder";
import { getEfSearch, getTopK, searchSimilarChunks } from "@/lib/rag/retrieval";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

// Minimal stub — only the rpc method is exercised by these tests.
function makeClient(
  result: { data: unknown; error: unknown },
): TypedSupabaseClient {
  return { rpc: vi.fn().mockResolvedValue(result) } as unknown as TypedSupabaseClient;
}

const TENANT_ID = "aa000000-0000-0000-0000-000000000001";
// Valid 768-dim vector: 1.0 at index 0, 0.0 elsewhere.
const EMBEDDING = Array.from({ length: EMBEDDING_DIM }, (_, i) =>
  i === 0 ? 1.0 : 0.0,
);

// ---------------------------------------------------------------------------
// getTopK
// ---------------------------------------------------------------------------

describe("getTopK", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 5 when RAG_TOP_K is unset", () => {
    vi.stubEnv("RAG_TOP_K", "");
    expect(getTopK()).toBe(5);
  });

  it("returns the parsed value when RAG_TOP_K is a valid positive integer", () => {
    vi.stubEnv("RAG_TOP_K", "10");
    expect(getTopK()).toBe(10);
  });

  it("returns 5 and warns when RAG_TOP_K is not a number", () => {
    vi.stubEnv("RAG_TOP_K", "abc");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getTopK()).toBe(5);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("RAG_TOP_K"));
    warn.mockRestore();
  });

  it("returns 5 and warns when RAG_TOP_K is zero", () => {
    vi.stubEnv("RAG_TOP_K", "0");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getTopK()).toBe(5);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns 5 and warns when RAG_TOP_K is negative", () => {
    vi.stubEnv("RAG_TOP_K", "-3");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getTopK()).toBe(5);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getEfSearch
// ---------------------------------------------------------------------------

describe("getEfSearch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 100 when RAG_HNSW_EF_SEARCH is unset", () => {
    vi.stubEnv("RAG_HNSW_EF_SEARCH", "");
    expect(getEfSearch()).toBe(100);
  });

  it("returns the parsed value when RAG_HNSW_EF_SEARCH is a valid positive integer", () => {
    vi.stubEnv("RAG_HNSW_EF_SEARCH", "200");
    expect(getEfSearch()).toBe(200);
  });

  it("returns 100 and warns when RAG_HNSW_EF_SEARCH is not a number", () => {
    vi.stubEnv("RAG_HNSW_EF_SEARCH", "abc");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getEfSearch()).toBe(100);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("RAG_HNSW_EF_SEARCH"));
    warn.mockRestore();
  });

  it("returns 100 and warns when RAG_HNSW_EF_SEARCH is zero", () => {
    vi.stubEnv("RAG_HNSW_EF_SEARCH", "0");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getEfSearch()).toBe(100);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns 100 and warns when RAG_HNSW_EF_SEARCH is negative", () => {
    vi.stubEnv("RAG_HNSW_EF_SEARCH", "-5");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getEfSearch()).toBe(100);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// searchSimilarChunks
// ---------------------------------------------------------------------------

describe("searchSimilarChunks", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps snake_case DB columns to camelCase ChunkMatch fields", async () => {
    const client = makeClient({
      data: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          chunk_text: "hello world",
          similarity: 0.95,
        },
      ],
      error: null,
    });

    const results = await searchSimilarChunks(client, TENANT_ID, EMBEDDING);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      chunkId: "chunk-1",
      documentId: "doc-1",
      chunkText: "hello world",
      similarity: 0.95,
    });
  });

  it("returns an empty array when no chunks match", async () => {
    const client = makeClient({ data: [], error: null });
    const results = await searchSimilarChunks(client, TENANT_ID, EMBEDDING);
    expect(results).toEqual([]);
  });

  it("throws with the error message and preserves cause when rpc returns an error", async () => {
    const supabaseError = {
      message: "expected 768 dimensions, not 512",
      code: "22000",
      details: "dimension mismatch",
    };
    const client = makeClient({ data: null, error: supabaseError });

    const promise = searchSimilarChunks(client, TENANT_ID, EMBEDDING);
    await expect(promise).rejects.toThrow("Vector similarity search failed");
    await expect(promise).rejects.toMatchObject({ cause: supabaseError });
  });

  it("throws on anomalous null data with no error", async () => {
    const client = makeClient({ data: null, error: null });
    await expect(
      searchSimilarChunks(client, TENANT_ID, EMBEDDING),
    ).rejects.toThrow("null data");
  });

  it("throws RangeError when queryEmbedding has wrong dimension", async () => {
    const client = makeClient({ data: [], error: null });
    const wrongDim = [1, 0, 0]; // 3-dim, not 768
    await expect(
      searchSimilarChunks(client, TENANT_ID, wrongDim),
    ).rejects.toThrow(RangeError);
    await expect(
      searchSimilarChunks(client, TENANT_ID, wrongDim),
    ).rejects.toThrow(`${EMBEDDING_DIM}`);
  });

  it("passes topK to rpc when provided", async () => {
    const client = makeClient({ data: [], error: null });
    await searchSimilarChunks(client, TENANT_ID, EMBEDDING, 3);
    expect(client.rpc).toHaveBeenCalledWith(
      "match_chunks",
      expect.objectContaining({ p_top_k: 3 }),
    );
  });

  it("uses getTopK() default when topK is omitted", async () => {
    vi.stubEnv("RAG_TOP_K", "");
    const client = makeClient({ data: [], error: null });
    await searchSimilarChunks(client, TENANT_ID, EMBEDDING);
    expect(client.rpc).toHaveBeenCalledWith(
      "match_chunks",
      expect.objectContaining({ p_top_k: 5 }),
    );
  });

  it("passes p_ef_search to rpc using getEfSearch() default when efSearch is omitted", async () => {
    vi.stubEnv("RAG_HNSW_EF_SEARCH", "");
    const client = makeClient({ data: [], error: null });
    await searchSimilarChunks(client, TENANT_ID, EMBEDDING);
    expect(client.rpc).toHaveBeenCalledWith(
      "match_chunks",
      expect.objectContaining({ p_ef_search: 100 }),
    );
  });

  it("passes an explicit efSearch value to rpc when provided", async () => {
    const client = makeClient({ data: [], error: null });
    await searchSimilarChunks(client, TENANT_ID, EMBEDDING, undefined, 150);
    expect(client.rpc).toHaveBeenCalledWith(
      "match_chunks",
      expect.objectContaining({ p_ef_search: 150 }),
    );
  });

  it("does not call rpc before validating embedding dimension", async () => {
    const client = makeClient({ data: [], error: null });
    await expect(
      searchSimilarChunks(client, TENANT_ID, [1, 2, 3]),
    ).rejects.toThrow(RangeError);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
