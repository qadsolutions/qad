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
