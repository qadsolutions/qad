/**
 * Inference provider abstraction for the RAG query endpoint (issue #30).
 *
 * The query route (`POST /api/query`) builds a grounded prompt and streams the model's
 * answer back to the browser. This module is the seam between that route and whichever
 * LLM backend is configured, mirroring the `createEmbedder()` pattern in
 * `src/lib/ingestion/embedder.ts`:
 *
 *   - `groq`  — the documented prototype provider (CLAUDE.md Stack table). Uses the
 *     Vercel AI SDK (`streamText`) with `@ai-sdk/groq`. SYNTHETIC DATA ONLY — Groq sends
 *     prompt context to Groq's servers, which violates the privacy guarantee for real
 *     client data (CLAUDE.md "Groq API — synthetic data only"). The M5 Ollama cutover
 *     happens before any real data is loaded.
 *   - `ollama` — production inference. Deferred to M5; throws a clear error here so a
 *     misconfigured deployment fails loudly rather than silently.
 *   - `mock`  — deterministic, no-network streamer for tests and CI (selected by
 *     `INFERENCE_PROVIDER=mock`, already set by `.github/workflows/ci.yml`). Also the
 *     safety-net fallback when the groq path is selected but `GROQ_API_KEY` is unset, so
 *     running the route locally without inference env configured can't attempt a live call.
 *
 * The route binds to {@link InferenceProvider}, never to the AI SDK directly, so the mock
 * is swappable and a future provider is a one-file change.
 *
 * STREAMING + PERSISTENCE CONTRACT: `streamChat` returns a {@link ChatStreamResult} whose
 * `toResponse()` produces the HTTP streaming Response sent to the browser. The optional
 * `onFinish` callback runs once, with the full answer text and token usage, and — for
 * every provider — completes BEFORE the response stream closes. That lets the route
 * persist the assistant message / retrieval log / model-call row in `onFinish` and lets a
 * test observe the writes simply by draining the response body.
 */

import { createGroq } from "@ai-sdk/groq";
import { streamText } from "ai";

/** Token usage reported by a finished generation, normalised across providers. */
export interface InferenceUsage {
  promptTokens: number;
  completionTokens: number;
}

/** What a finished generation reports to the route for persistence. */
export interface InferenceFinish {
  /** The full assistant answer (all streamed deltas concatenated). */
  text: string;
  usage: InferenceUsage;
}

export interface StreamChatOptions {
  /** Grounding/system instructions (from `buildPrompt`). */
  system: string;
  /** The user turn: retrieved context + question (from `buildPrompt`). */
  prompt: string;
  /**
   * Invoked exactly once when generation finishes, before the response stream closes.
   * The route persists the assistant message + logs here. Errors thrown by the callback
   * are the route's responsibility to contain — see the route's best-effort logging.
   */
  onFinish?: (finish: InferenceFinish) => void | Promise<void>;
}

export interface ChatStreamResult {
  /**
   * Build the HTTP streaming Response for the browser. `init` headers are merged in —
   * the route uses this to attach the `X-Citations` header (see the route for why a
   * header, not an in-band part, carries citations).
   */
  toResponse(init?: ResponseInit): Response;
}

export interface InferenceProvider {
  /** Model identifier recorded on `model_calls.model_name`. */
  readonly modelName: string;
  streamChat(options: StreamChatOptions): ChatStreamResult;
}

/** Default Groq chat model — a Groq tag, NOT the Ollama `LLM_MODEL` (llama3.2). */
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

/** Resolve the Groq model id from `GROQ_MODEL`, defaulting to {@link DEFAULT_GROQ_MODEL}. */
export function getGroqModel(): string {
  // `|| default` covers both unset and empty string (both falsy).
  return process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
}

function requireEnv(name: "GROQ_API_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Shared text-stream builder used by the mock provider. Emits each piece of `textChunks`
 * as a separate UTF-8 stream chunk, then runs `onFinish` (awaited) before closing — so a
 * consumer that drains the body has observed `onFinish` by the time it resolves. This is
 * the same ordering the AI SDK guarantees for the groq path (it awaits the finish
 * callback before the stream ends), keeping the two paths behaviourally identical.
 */
function buildTextStreamResult(
  textChunks: string[],
  fullText: string,
  usage: InferenceUsage,
  onFinish: StreamChatOptions["onFinish"],
): ChatStreamResult {
  return {
    toResponse(init?: ResponseInit): Response {
      const encoder = new TextEncoder();
      let index = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (index < textChunks.length) {
            controller.enqueue(encoder.encode(textChunks[index]));
            index += 1;
            return;
          }
          // All deltas sent — run the finish callback (persistence) before closing.
          if (onFinish) await onFinish({ text: fullText, usage });
          controller.close();
        },
      });

      const headers = new Headers(init?.headers);
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "text/plain; charset=utf-8");
      }
      return new Response(stream, { ...init, headers });
    },
  };
}

/** A fixed, citation-bearing answer split across a few chunks so streaming is exercised. */
const MOCK_ANSWER_PARTS = ["Based on the provided context, ", "this is a mock answer", " [1]."];
const MOCK_ANSWER = MOCK_ANSWER_PARTS.join("");

/** Deterministic, no-network provider for tests and CI (no Groq/Ollama reachable there). */
class MockInferenceProvider implements InferenceProvider {
  readonly modelName = "mock";

  streamChat(options: StreamChatOptions): ChatStreamResult {
    // Deterministic, non-zero token counts so model_calls persistence is exercised
    // without depending on a real tokenizer — word counts are reproducible and cheap.
    const usage: InferenceUsage = {
      promptTokens: countWords(options.system) + countWords(options.prompt),
      completionTokens: countWords(MOCK_ANSWER),
    };
    return buildTextStreamResult(MOCK_ANSWER_PARTS, MOCK_ANSWER, usage, options.onFinish);
  }
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Prototype provider: streams from Groq via the Vercel AI SDK. SYNTHETIC DATA ONLY. */
class GroqInferenceProvider implements InferenceProvider {
  readonly modelName: string;

  constructor() {
    this.modelName = getGroqModel();
  }

  streamChat(options: StreamChatOptions): ChatStreamResult {
    const groq = createGroq({ apiKey: requireEnv("GROQ_API_KEY") });
    const result = streamText({
      model: groq(this.modelName),
      system: options.system,
      prompt: options.prompt,
      // `onEnd` fires after the full generation; the SDK awaits it before the stream
      // ends, so the route's persistence completes before the response body closes.
      // NOTE (M5 trap): `event.text` is a `string` for single-step calls (our case). If a
      // multi-step config (e.g. `stopWhen`) is ever added, `event.text` becomes a
      // `Promise<string>` — re-verify this access then, or it would persist "[object Promise]".
      onEnd: async (event) => {
        if (!options.onFinish) return;
        await options.onFinish({
          text: event.text,
          usage: {
            promptTokens: event.usage.inputTokens ?? 0,
            completionTokens: event.usage.outputTokens ?? 0,
          },
        });
      },
    });

    return {
      toResponse: (init?: ResponseInit) => result.toTextStreamResponse(init),
    };
  }
}

/**
 * Select the inference provider from `INFERENCE_PROVIDER`, mirroring `createEmbedder()`:
 *   - `mock`   → deterministic streamer (tests/CI).
 *   - `ollama` → throws; the Ollama path lands in M5.
 *   - `groq` (default) → real Groq, but falls back to the mock when `GROQ_API_KEY` is
 *     unset — a safety net so a local run without inference env can't attempt a live call.
 */
export function createInferenceProvider(): InferenceProvider {
  const provider = process.env.INFERENCE_PROVIDER;

  if (provider === "mock") {
    return new MockInferenceProvider();
  }
  if (provider === "ollama") {
    throw new Error(
      "Ollama inference provider is configured in M5 (provider abstraction). " +
        "Set INFERENCE_PROVIDER=groq (prototype) or =mock (tests) for now.",
    );
  }

  // Default/groq path. Fall back to the mock when no key is configured (embedder parity) —
  // but WARN loudly so a prod deploy that forgot GROQ_API_KEY can't silently serve mock
  // answers to real users. (Failing closed in production is deferred to M10 hardening.)
  if (!process.env.GROQ_API_KEY) {
    console.warn(
      "INFERENCE_PROVIDER=groq but GROQ_API_KEY is unset — using the mock inference provider. " +
        "Set GROQ_API_KEY for real inference (mock answers are not real).",
    );
    return new MockInferenceProvider();
  }
  return new GroqInferenceProvider();
}
