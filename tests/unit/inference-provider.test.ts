import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createInferenceProvider,
  DEFAULT_GROQ_MODEL,
  getGroqModel,
  type InferenceFinish,
} from "@/lib/inference/provider";

/**
 * Unit tests for the inference provider abstraction (issue #30).
 *
 * No live Groq/Ollama is ever contacted: the mock path is deterministic and no-network,
 * the ollama path is expected to throw (deferred to M5), and the groq path is only
 * *selected* (constructed) — never streamed — so env wiring is verified without a call.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getGroqModel", () => {
  it("defaults to the Groq tag when GROQ_MODEL is unset", () => {
    vi.stubEnv("GROQ_MODEL", "");
    expect(getGroqModel()).toBe(DEFAULT_GROQ_MODEL);
    expect(DEFAULT_GROQ_MODEL).toBe("llama-3.3-70b-versatile");
  });

  it("reads a GROQ_MODEL override", () => {
    vi.stubEnv("GROQ_MODEL", "llama-3.1-8b-instant");
    expect(getGroqModel()).toBe("llama-3.1-8b-instant");
  });
});

describe("createInferenceProvider — selection", () => {
  it("throws a clear M5 error for the ollama provider", () => {
    vi.stubEnv("INFERENCE_PROVIDER", "ollama");
    expect(() => createInferenceProvider()).toThrowError(/M5/);
  });

  it("selects the real Groq provider when groq + GROQ_API_KEY are set", () => {
    vi.stubEnv("INFERENCE_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "gsk_synthetic_test_key");
    vi.stubEnv("GROQ_MODEL", "");
    const provider = createInferenceProvider();
    // modelName comes from GROQ_MODEL — proves the groq branch was taken without a live call.
    expect(provider.modelName).toBe(DEFAULT_GROQ_MODEL);
  });

  it("falls back to the mock when groq is selected but GROQ_API_KEY is unset", () => {
    vi.stubEnv("INFERENCE_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "");
    expect(createInferenceProvider().modelName).toBe("mock");
  });
});

describe("MockInferenceProvider — deterministic streaming", () => {
  it("streams a fixed answer and runs onFinish (with usage) before the stream closes", async () => {
    vi.stubEnv("INFERENCE_PROVIDER", "mock");
    const finishes: InferenceFinish[] = [];
    const provider = createInferenceProvider();
    expect(provider.modelName).toBe("mock");

    const res = provider
      .streamChat({
        system: "system instructions here",
        prompt: "Context: [1] foo\n\nQuestion: bar",
        onFinish: async (f) => {
          finishes.push(f);
        },
      })
      .toResponse({ headers: { "X-Citations": '["abc"]' } });

    const text = await res.text();

    // Deterministic answer, exercised across multiple stream chunks.
    expect(text).toBe("Based on the provided context, this is a mock answer [1].");
    expect(res.headers.get("X-Citations")).toBe('["abc"]');
    expect(res.headers.get("Content-Type")).toContain("text/plain");

    // onFinish ran exactly once, before the body resolved, with non-zero token usage.
    expect(finishes).toHaveLength(1);
    expect(finishes[0].text).toBe(text);
    expect(finishes[0].usage.promptTokens).toBeGreaterThan(0);
    expect(finishes[0].usage.completionTokens).toBeGreaterThan(0);
  });

  it("is reproducible — same input yields the same answer and usage", async () => {
    vi.stubEnv("INFERENCE_PROVIDER", "mock");
    const provider = createInferenceProvider();
    const run = async () => {
      let finish: InferenceFinish | undefined;
      const res = provider
        .streamChat({ system: "s", prompt: "p", onFinish: async (f) => void (finish = f) })
        .toResponse();
      const text = await res.text();
      return { text, finish };
    };
    const a = await run();
    const b = await run();
    expect(a.text).toBe(b.text);
    expect(a.finish?.usage).toEqual(b.finish?.usage);
  });
});
