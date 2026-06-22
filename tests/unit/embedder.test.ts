import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertEmbeddingDimensions,
  createEmbedder,
  EMBEDDING_DIM,
  EmbeddingDimensionError,
} from "@/lib/ingestion/embedder";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertEmbeddingDimensions", () => {
  it("passes silently when every vector is EMBEDDING_DIM long", () => {
    expect(() =>
      assertEmbeddingDimensions([new Array(EMBEDDING_DIM).fill(0)]),
    ).not.toThrow();
  });

  it("throws EmbeddingDimensionError when a vector has the wrong length", () => {
    expect(() => assertEmbeddingDimensions([[1, 2, 3]])).toThrow(EmbeddingDimensionError);
  });
});

describe("createEmbedder — fake/mock selection", () => {
  it("returns a deterministic fake embedder when INFERENCE_PROVIDER=mock", async () => {
    vi.stubEnv("INFERENCE_PROVIDER", "mock");
    const embedder = createEmbedder();

    expect(embedder.modelVersion).toBe("mock");
    const [v1] = await embedder.embed(["same text"]);
    const [v2] = await embedder.embed(["same text"]);
    const [v3] = await embedder.embed(["different text"]);

    expect(v1).toHaveLength(EMBEDDING_DIM);
    expect(v1).toEqual(v2); // deterministic
    expect(v1).not.toEqual(v3); // different input -> different vector
  });

  it("the fake embedder returns an empty array for an empty input array", async () => {
    vi.stubEnv("INFERENCE_PROVIDER", "mock");
    const embedder = createEmbedder();
    expect(await embedder.embed([])).toEqual([]);
  });

  it("falls back to the fake embedder when OLLAMA_EMBED_URL is unset, even if INFERENCE_PROVIDER isn't mock", () => {
    // docs/m3-plan.md's embedder checklist (item 4): fake when INFERENCE_PROVIDER=mock
    // OR OLLAMA_EMBED_URL is unset — a safety net so a dev running tests without any
    // ingestion-specific env configured doesn't accidentally try a real network call.
    vi.stubEnv("INFERENCE_PROVIDER", "ollama");
    vi.stubEnv("OLLAMA_EMBED_URL", "");
    expect(createEmbedder().modelVersion).toBe("mock");
  });
});

describe("createEmbedder — real Ollama selection", () => {
  it("calls POST {OLLAMA_EMBED_URL}/api/embed with {model, input} and returns the embeddings", async () => {
    vi.stubEnv("INFERENCE_PROVIDER", "ollama");
    vi.stubEnv("OLLAMA_EMBED_URL", "http://test-ollama:11434");
    vi.stubEnv("EMBEDDING_MODEL", "nomic-embed-text");

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ embeddings: [new Array(768).fill(0.1), new Array(768).fill(0.2)] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const embedder = createEmbedder();
    expect(embedder.modelVersion).toBe("nomic-embed-text");

    const result = await embedder.embed(["chunk one", "chunk two"]);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "http://test-ollama:11434/api/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "nomic-embed-text", input: ["chunk one", "chunk two"] }),
      }),
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(768);
  });

  it("throws when Ollama returns a non-OK response", async () => {
    vi.stubEnv("INFERENCE_PROVIDER", "ollama");
    vi.stubEnv("OLLAMA_EMBED_URL", "http://test-ollama:11434");
    vi.stubEnv("EMBEDDING_MODEL", "does-not-exist");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "model not found" }), { status: 404 })),
    );

    const embedder = createEmbedder();
    await expect(embedder.embed(["hi"])).rejects.toThrow(/404/);
  });

  it("throws EmbeddingDimensionError when Ollama returns the wrong dimension", async () => {
    vi.stubEnv("INFERENCE_PROVIDER", "ollama");
    vi.stubEnv("OLLAMA_EMBED_URL", "http://test-ollama:11434");
    vi.stubEnv("EMBEDDING_MODEL", "nomic-embed-text");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ embeddings: [[1, 2, 3]] }), { status: 200 })),
    );

    const embedder = createEmbedder();
    await expect(embedder.embed(["hi"])).rejects.toThrow(EmbeddingDimensionError);
  });

  it("returns an empty array without calling fetch for an empty input array", async () => {
    vi.stubEnv("INFERENCE_PROVIDER", "ollama");
    vi.stubEnv("OLLAMA_EMBED_URL", "http://test-ollama:11434");
    vi.stubEnv("EMBEDDING_MODEL", "nomic-embed-text");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const embedder = createEmbedder();
    expect(await embedder.embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
