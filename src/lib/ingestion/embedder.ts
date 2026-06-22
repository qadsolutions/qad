import { createHash } from "node:crypto";

/** Matches the `vector(768)` column on `embeddings` (nomic-embed-text's dimension). */
export const EMBEDDING_DIM = 768;

export class EmbeddingDimensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingDimensionError";
  }
}

/**
 * Reject any vector whose length isn't EMBEDDING_DIM, before it ever reaches the
 * DB. The `vector(768)` column would reject it anyway, but failing here gives a
 * clear, typed error instead of an opaque Postgres error from deep inside a bulk
 * insert (decision D2, docs/m3-plan.md).
 */
export function assertEmbeddingDimensions(vectors: number[][]): void {
  for (const vector of vectors) {
    if (vector.length !== EMBEDDING_DIM) {
      throw new EmbeddingDimensionError(
        `Expected ${EMBEDDING_DIM}-dim embedding, got ${vector.length}`,
      );
    }
  }
}

/**
 * Embeds text into vectors. `modelVersion` is recorded on every `embeddings` row
 * so a future model change can be identified per-row — it comes from the
 * embedder itself (not re-read from env separately) so the recorded value can
 * never drift from what actually produced the vector.
 */
export interface Embedder {
  readonly modelVersion: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** No-network, reproducible embedder for tests and CI (no Ollama service there). */
class FakeEmbedder implements Embedder {
  readonly modelVersion = "mock";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => deterministicVector(text));
  }
}

/** Hash `text` into a reproducible EMBEDDING_DIM-length vector via a seeded PRNG. */
function deterministicVector(text: string): number[] {
  const hash = createHash("sha256").update(text).digest();
  let seed = hash.readUInt32BE(0);
  const vector = new Array<number>(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    // mulberry32 PRNG step
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    vector[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return vector;
}

/**
 * Select the embedder implementation: fake/deterministic in tests and CI
 * (`INFERENCE_PROVIDER=mock` — already set by `.github/workflows/ci.yml`'s
 * `unit-tests` job), real Ollama otherwise. Also falls back to fake when
 * `OLLAMA_EMBED_URL` is simply unset (docs/m3-plan.md embedder checklist, item
 * 4) — a safety net so running tests locally without ingestion-specific env
 * configured can't accidentally attempt a real network call. See Task B3 for
 * the Ollama branch.
 */
export function createEmbedder(): Embedder {
  if (process.env.INFERENCE_PROVIDER === "mock" || !process.env.OLLAMA_EMBED_URL) {
    return new FakeEmbedder();
  }
  return createOllamaEmbedder();
}

// Placeholder swapped for the real implementation in Task B3 — DO NOT leave this
// as-is; Task B3 replaces this function body entirely.
function createOllamaEmbedder(): Embedder {
  throw new Error("Ollama embedder not implemented yet (see Task B3)");
}
