import { getEncoding } from "js-tiktoken";

/**
 * RAG prompt builder (issue #29).
 *
 * Turns the chunks returned by tenant-filtered retrieval (#28) into the prompt the
 * inference layer (#30 / M5) sends to the model: fixed grounding instructions, the
 * retrieved context, and the user's question — plus the list of chunk ids actually
 * included, which the endpoint reuses for citations and `retrieval_logs` (#31).
 *
 * This module is pure (no DB, no network) so it unit-tests in isolation and stays
 * independent of how retrieval or inference are wired.
 *
 * `cl100k_base` is reused here as the token *counter* for the same reason
 * `chunking.ts` uses it: a consistent, dependency-light way to size text. It does not
 * need to match the inference model's own tokenizer — the budget is a safety bound on
 * context size, not an exact accounting of the model's prompt tokens.
 */
const encoding = getEncoding("cl100k_base");

/**
 * Default token budget for the retrieved-context section of a single prompt. Ingestion
 * caps chunks at ~512 tokens (`CHUNK_SIZE_TOKENS`), so 3000 holds roughly the top 5–6
 * chunks — aligned with the default `RAG_TOP_K=5` — while bounding the prompt so a
 * large top-k can't blow past the inference context window.
 */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 3000;

/**
 * System instructions: constrain the model to answer *only* from the supplied context
 * and to cite sources by their bracket number. The endpoint short-circuits the
 * no-context case before inference (#97); this instruction is the second line of
 * defence for when retrieval returns weak-but-nonempty context.
 */
export const SYSTEM_INSTRUCTIONS = [
  "You are a helpful assistant answering questions for a specific business using only that business's own documents.",
  "",
  "Rules:",
  "- Answer using ONLY the information in the Context section below. Do not rely on outside or prior knowledge.",
  "- If the answer is not contained in the context, say you don't have that information in the available documents. Do not guess.",
  "- Cite the sources you used by their bracketed number, e.g. [1] or [2].",
  "- Be concise and accurate.",
].join("\n");

/**
 * Minimal shape the builder needs from a retrieved chunk. Matches the subset of #28's
 * retrieval result used here; `similarity` is optional so the builder also works with
 * inputs that don't carry a score (it then preserves input order).
 */
export interface PromptChunk {
  chunkId: string;
  chunkText: string;
  /** Cosine similarity in [0, 1] from retrieval; higher is more relevant. */
  similarity?: number;
}

export interface BuiltPrompt {
  /** Fixed grounding instructions. */
  system: string;
  /** Retrieved context followed by the user's question. */
  user: string;
  /** Chunk ids actually included in `user`, in presentation order — for citations + #31. */
  chunkIdsUsed: string[];
}

export interface BuildPromptOptions {
  /** Override the context token budget; defaults to {@link getContextTokenBudget}. */
  contextTokenBudget?: number;
}

/** Count `cl100k_base` tokens in `text`. Exported for callers that pre-budget context. */
export function countTokens(text: string): number {
  return encoding.encode(text).length;
}

/** Truncate `text` to at most `maxTokens` `cl100k_base` tokens. */
function truncateToTokens(text: string, maxTokens: number): string {
  const tokens = encoding.encode(text);
  if (tokens.length <= maxTokens) return text;
  return encoding.decode(tokens.slice(0, maxTokens));
}

/**
 * Resolve the context token budget from `RAG_CONTEXT_TOKEN_BUDGET`, falling back to
 * {@link DEFAULT_CONTEXT_TOKEN_BUDGET}. Throws on a present-but-invalid value rather
 * than silently using the default, so a misconfigured deployment fails loudly.
 */
export function getContextTokenBudget(): number {
  const raw = process.env.RAG_CONTEXT_TOKEN_BUDGET;
  if (raw === undefined || raw === "") return DEFAULT_CONTEXT_TOKEN_BUDGET;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `RAG_CONTEXT_TOKEN_BUDGET must be a positive integer, got "${raw}"`,
    );
  }
  return value;
}

/**
 * Build the RAG prompt from a question and retrieved chunks.
 *
 * Chunks are ranked by descending similarity (stable for ties / missing scores), then
 * included in rank order while they fit the token budget — stopping at the first chunk
 * that would overflow, so the highest-similarity chunks are always the ones kept and
 * citation numbering follows relevance. If even the single top chunk exceeds the
 * budget, it is included truncated rather than dropped, so the most relevant context
 * is never lost entirely.
 *
 * Returns an empty-context prompt (and empty `chunkIdsUsed`) when `chunks` is empty;
 * deciding whether to call inference at all in that case is the endpoint's job (#97).
 */
export function buildPrompt(
  question: string,
  chunks: PromptChunk[],
  options: BuildPromptOptions = {},
): BuiltPrompt {
  const budget = options.contextTokenBudget ?? getContextTokenBudget();

  // Stable sort by similarity desc: chunks without a score keep their input order
  // relative to each other (treated as 0) and fall after scored chunks.
  const ranked = chunks
    .map((chunk, index) => ({ chunk, index }))
    .sort((a, b) => {
      const diff = (b.chunk.similarity ?? 0) - (a.chunk.similarity ?? 0);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map((entry) => entry.chunk);

  const selected: Array<{ chunk: PromptChunk; text: string }> = [];
  let used = 0;
  for (const chunk of ranked) {
    const tokens = countTokens(chunk.chunkText);
    if (selected.length === 0 && tokens > budget) {
      // Even the most relevant chunk alone exceeds the budget — keep it, truncated,
      // rather than emit empty context.
      selected.push({ chunk, text: truncateToTokens(chunk.chunkText, budget) });
      break;
    }
    if (used + tokens > budget) break;
    selected.push({ chunk, text: chunk.chunkText });
    used += tokens;
  }

  const chunkIdsUsed = selected.map((entry) => entry.chunk.chunkId);
  const context =
    selected.length > 0
      ? selected.map((entry, i) => `[${i + 1}] ${entry.text}`).join("\n\n")
      : "No relevant context was retrieved.";

  const user = `Context:\n${context}\n\nQuestion: ${question}`;

  return { system: SYSTEM_INSTRUCTIONS, user, chunkIdsUsed };
}
