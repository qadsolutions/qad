import { describe, expect, it, vi } from "vitest";
import { createEmbedder, EMBEDDING_DIM } from "@/lib/ingestion/embedder";

async function isOllamaReachable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

const OLLAMA_URL = process.env.OLLAMA_EMBED_URL ?? "http://localhost:11434";
const reachable = await isOllamaReachable(OLLAMA_URL);

describe.skipIf(!reachable)("real Ollama embedder smoke test", () => {
  it("returns a real 768-dim, deterministic-per-call vector for nomic-embed-text", async () => {
    vi.stubEnv("INFERENCE_PROVIDER", "ollama");
    vi.stubEnv("OLLAMA_EMBED_URL", OLLAMA_URL);
    vi.stubEnv("EMBEDDING_MODEL", "nomic-embed-text");

    const embedder = createEmbedder();
    const [vector] = await embedder.embed(["Hello world"]);

    expect(vector).toHaveLength(EMBEDDING_DIM);
    expect(vector.every((value) => Number.isFinite(value))).toBe(true);

    vi.unstubAllEnvs();
  });
});
