import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildPrompt } from "@/lib/rag/prompt";
import { createInferenceProvider, type InferenceFinish } from "@/lib/inference/provider";

/**
 * Live Groq smoke test for the inference provider (issue #30's deferred "measure TTFT/full
 * response" AC). GATED: it skips unless a real GROQ_API_KEY is available, so it never runs
 * in CI (which uses INFERENCE_PROVIDER=mock) — same posture as the Ollama embedder smoke.
 *
 * The key lives in `.env.local` (gitignored). vitest.config only auto-loads
 * `.env.test.local`, so this file reads `.env.local` itself and gates on the key — the key
 * is never printed and never committed.
 *
 * SYNTHETIC DATA ONLY (CLAUDE.md "Groq API — synthetic data only"): the prompt below is a
 * fabricated business fact, never a real client document.
 */

/** Minimal KEY=VALUE reader for `.env.local` (mirrors vitest.config's parser; no dotenv). */
function readEnvLocal(): Record<string, string> {
  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

const envLocal = readEnvLocal();
const GROQ_API_KEY = process.env.GROQ_API_KEY ?? envLocal.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL ?? envLocal.GROQ_MODEL;

// Perf targets from CLAUDE.md.
const TTFT_TARGET_MS = 3_000;
const FULL_RESPONSE_TARGET_MS = 10_000;

describe.skipIf(!GROQ_API_KEY)("Groq live inference smoke test", () => {
  it(
    "streams a grounded answer from synthetic context and meets the TTFT/full-response targets",
    async () => {
      vi.stubEnv("INFERENCE_PROVIDER", "groq");
      vi.stubEnv("GROQ_API_KEY", GROQ_API_KEY as string);
      if (GROQ_MODEL) vi.stubEnv("GROQ_MODEL", GROQ_MODEL);

      // Fabricated business fact — synthetic data only.
      const built = buildPrompt("What is Acme Widgets' return policy?", [
        {
          chunkId: "syn-1",
          chunkText:
            "Acme Widgets accepts returns within 30 days of purchase with the original receipt, " +
            "issued as store credit. Opened electronics are non-returnable.",
          similarity: 0.93,
        },
      ]);

      let finish: InferenceFinish | undefined;
      const provider = createInferenceProvider();
      expect(provider.modelName).not.toBe("mock"); // guard: we're actually on the Groq path

      const result = provider.streamChat({
        system: built.system,
        prompt: built.user,
        onFinish: (f) => {
          finish = f;
        },
      });

      const startedAt = Date.now();
      const res = result.toResponse();
      expect(res.body).not.toBeNull();

      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let ttftMs: number | undefined;
      let answer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (ttftMs === undefined) ttftMs = Date.now() - startedAt;
        answer += decoder.decode(value, { stream: true });
      }
      const totalMs = Date.now() - startedAt;

      // Log the measured numbers so the run reports them (perf AC evidence).
      console.info(
        `[groq-smoke] model=${provider.modelName} TTFT=${ttftMs}ms total=${totalMs}ms ` +
          `answerChars=${answer.length} usage=${JSON.stringify(finish?.usage)}`,
      );

      expect(answer.trim().length).toBeGreaterThan(0);
      expect(ttftMs).toBeDefined();
      expect(ttftMs as number).toBeLessThan(TTFT_TARGET_MS);
      expect(totalMs).toBeLessThan(FULL_RESPONSE_TARGET_MS);

      // onFinish ran before the stream closed, with usage.
      expect(finish).toBeDefined();
      expect(finish?.text.length).toBeGreaterThan(0);
      expect(finish?.usage.completionTokens).toBeGreaterThan(0);

      vi.unstubAllEnvs();
    },
    FULL_RESPONSE_TARGET_MS + 10_000, // generous test timeout around the live call
  );
});
