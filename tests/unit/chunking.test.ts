import { describe, expect, it } from "vitest";
import { chunkText, CHUNK_OVERLAP_TOKENS, CHUNK_SIZE_TOKENS } from "@/lib/ingestion/chunking";

describe("chunkText", () => {
  it("returns a single chunk for text shorter than one chunk", () => {
    const chunks = chunkText("just a few words here");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ index: 0 });
    expect(chunks[0].text).toContain("just a few words here");
  });

  it("returns no chunks for empty text", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("splits long text into overlapping chunks with sequential indices", () => {
    // ~1201 tokens of repeated 4-word phrase, verified via js-tiktoken cl100k_base.
    const longText = "alpha beta gamma delta ".repeat(300);
    const chunks = chunkText(longText, 500, 50);

    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(chunks[0].tokenCount).toBe(500);
    expect(chunks[1].tokenCount).toBe(500);
    expect(chunks[2].tokenCount).toBe(301);
  });

  it("uses the default CHUNK_SIZE_TOKENS/CHUNK_OVERLAP_TOKENS when not overridden", () => {
    const longText = "alpha beta gamma delta ".repeat(300);
    const withDefaults = chunkText(longText);
    const withExplicitDefaults = chunkText(longText, CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS);
    expect(withDefaults).toEqual(withExplicitDefaults);
  });

  it("throws synchronously when overlapTokens >= sizeTokens, instead of looping forever", () => {
    // Regression guard: a naive `start += sizeTokens - overlapTokens` step of 0
    // (or negative) never advances `start`, so the loop never terminates.
    expect(() => chunkText("some text", 10, 10)).toThrow(/overlapTokens/);
    expect(() => chunkText("some text", 10, 11)).toThrow(/overlapTokens/);
  });
});
