import { getEncoding } from "js-tiktoken";

/**
 * Token-based chunking for the ingestion pipeline (issue #25).
 *
 * `cl100k_base` is used purely as a consistent, fast, dependency-light token
 * *counter* for chunk sizing — it does not need to match nomic-embed-text's own
 * tokenizer (which isn't published as a standalone JS package). The goal is
 * predictable chunk boundaries, not exact token-for-token fidelity with the
 * embedding model.
 */
const encoding = getEncoding("cl100k_base");

/** Target chunk size, in cl100k_base tokens. */
export const CHUNK_SIZE_TOKENS = 500;
/** Overlap between consecutive chunks, in cl100k_base tokens. */
export const CHUNK_OVERLAP_TOKENS = 50;

export interface TextChunk {
  text: string;
  index: number;
  tokenCount: number;
}

/**
 * Split `text` into overlapping chunks of at most `sizeTokens` tokens, advancing
 * by `sizeTokens - overlapTokens` each step so consecutive chunks share
 * `overlapTokens` tokens of context.
 *
 * `overlapTokens` must be strictly less than `sizeTokens`: the step size is
 * `sizeTokens - overlapTokens`, and a step of zero or negative never advances
 * `start`, which would loop forever over the same token window.
 */
export function chunkText(
  text: string,
  sizeTokens: number = CHUNK_SIZE_TOKENS,
  overlapTokens: number = CHUNK_OVERLAP_TOKENS,
): TextChunk[] {
  if (overlapTokens >= sizeTokens) {
    throw new Error(
      `overlapTokens (${overlapTokens}) must be less than sizeTokens (${sizeTokens})`,
    );
  }

  const tokens = encoding.encode(text);
  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < tokens.length) {
    const end = Math.min(start + sizeTokens, tokens.length);
    chunks.push({
      text: encoding.decode(tokens.slice(start, end)),
      index,
      tokenCount: end - start,
    });
    index += 1;
    if (end === tokens.length) break;
    start += sizeTokens - overlapTokens;
  }

  return chunks;
}
