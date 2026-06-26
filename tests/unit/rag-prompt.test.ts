import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPrompt,
  countTokens,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  getContextTokenBudget,
  SYSTEM_INSTRUCTIONS,
  type PromptChunk,
} from "@/lib/rag/prompt";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildPrompt", () => {
  const chunks: PromptChunk[] = [
    { chunkId: "c-low", chunkText: "Refunds are processed within 30 days.", similarity: 0.41 },
    { chunkId: "c-high", chunkText: "Our return window is 14 days from delivery.", similarity: 0.92 },
    { chunkId: "c-mid", chunkText: "Exchanges require the original receipt.", similarity: 0.67 },
  ];

  it("includes the fixed system instructions, the context, and the question", () => {
    const prompt = buildPrompt("What is the return window?", chunks);

    expect(prompt.system).toBe(SYSTEM_INSTRUCTIONS);
    expect(prompt.user).toContain("Question: What is the return window?");
    expect(prompt.user).toContain("Our return window is 14 days from delivery.");
    expect(prompt.user.startsWith("Context:")).toBe(true);
  });

  it("ranks chunks by descending similarity and numbers citations in that order", () => {
    const prompt = buildPrompt("q", chunks);

    // c-high (0.92) → [1], c-mid (0.67) → [2], c-low (0.41) → [3]
    expect(prompt.chunkIdsUsed).toEqual(["c-high", "c-mid", "c-low"]);
    expect(prompt.user.indexOf("[1] Our return window")).toBeGreaterThan(-1);
    expect(prompt.user.indexOf("[2] Exchanges require")).toBeGreaterThan(-1);
    expect(prompt.user.indexOf("[3] Refunds are processed")).toBeGreaterThan(-1);
    // Higher-ranked chunk appears earlier in the prompt text.
    expect(prompt.user.indexOf("[1]")).toBeLessThan(prompt.user.indexOf("[2]"));
  });

  it("preserves input order for chunks without similarity scores", () => {
    const unscored: PromptChunk[] = [
      { chunkId: "a", chunkText: "first" },
      { chunkId: "b", chunkText: "second" },
    ];
    expect(buildPrompt("q", unscored).chunkIdsUsed).toEqual(["a", "b"]);
  });

  it("ranks scored chunks above unscored ones and keeps unscored in input order", () => {
    const mixed: PromptChunk[] = [
      { chunkId: "no-score-1", chunkText: "u-one" },
      { chunkId: "scored-low", chunkText: "s-low", similarity: 0.2 },
      { chunkId: "no-score-2", chunkText: "u-two" },
      { chunkId: "scored-high", chunkText: "s-high", similarity: 0.9 },
    ];
    // Scored (0.9, 0.2) first in score order; unscored (treated as 0) after, in input order.
    expect(buildPrompt("q", mixed).chunkIdsUsed).toEqual([
      "scored-high",
      "scored-low",
      "no-score-1",
      "no-score-2",
    ]);
  });

  it("drops lower-ranked chunks once the token budget is exhausted", () => {
    const big = "word ".repeat(40).trim(); // ~40 tokens each
    const many: PromptChunk[] = [
      { chunkId: "keep-1", chunkText: big, similarity: 0.9 },
      { chunkId: "keep-2", chunkText: big, similarity: 0.8 },
      { chunkId: "drop", chunkText: big, similarity: 0.1 },
    ];

    // Budget fits two ~40-token chunks but not the third.
    const prompt = buildPrompt("q", many, { contextTokenBudget: 100 });

    expect(prompt.chunkIdsUsed).toEqual(["keep-1", "keep-2"]);
    expect(prompt.user).not.toContain("[3]");
  });

  it("includes a chunk that lands exactly on the budget boundary (inclusive)", () => {
    const text = "alpha beta gamma delta";
    const n = countTokens(text);
    const two: PromptChunk[] = [
      { chunkId: "first", chunkText: text, similarity: 0.9 },
      { chunkId: "second", chunkText: text, similarity: 0.8 },
    ];

    // Budget is exactly two chunks' worth: `used + tokens > budget` is strict, so the
    // second chunk (landing on the boundary, used + tokens === budget) is kept.
    const prompt = buildPrompt("q", two, { contextTokenBudget: n * 2 });
    expect(prompt.chunkIdsUsed).toEqual(["first", "second"]);
  });

  it("includes the single top chunk truncated, with real content, when it alone exceeds the budget", () => {
    const huge = "alpha bravo charlie delta echo ".repeat(50).trim();
    expect(countTokens(huge)).toBeGreaterThan(10);

    const prompt = buildPrompt("q", [{ chunkId: "only", chunkText: huge, similarity: 0.9 }], {
      contextTokenBudget: 10,
    });

    expect(prompt.chunkIdsUsed).toEqual(["only"]);

    // The truncated context must carry real, non-empty content from the chunk — not an
    // empty "[1] " citation — and be a genuine prefix of the original text.
    const rendered = prompt.user.split("\n\nQuestion:")[0].replace(/^Context:\n\[1\] /, "");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.trim()).not.toBe("");
    expect(huge.startsWith(rendered)).toBe(true);
    expect(countTokens(rendered)).toBeLessThanOrEqual(10);
  });

  it("emits an explicit no-context prompt and empty chunkIdsUsed for zero chunks", () => {
    const prompt = buildPrompt("anything?", []);

    expect(prompt.chunkIdsUsed).toEqual([]);
    expect(prompt.user).toContain("No relevant context was retrieved.");
    expect(prompt.user).toContain("Question: anything?");
  });

  it.each([0, -1, NaN, 12.5])(
    "throws on an invalid contextTokenBudget override (%s) instead of silently degrading",
    (value) => {
      expect(() =>
        buildPrompt("q", [{ chunkId: "a", chunkText: "text", similarity: 0.9 }], {
          contextTokenBudget: value,
        }),
      ).toThrow(/contextTokenBudget must be a positive integer/);
    },
  );
});

describe("getContextTokenBudget", () => {
  it("defaults when the env var is unset or empty", () => {
    vi.stubEnv("RAG_CONTEXT_TOKEN_BUDGET", "");
    expect(getContextTokenBudget()).toBe(DEFAULT_CONTEXT_TOKEN_BUDGET);
  });

  it("reads a positive integer override", () => {
    vi.stubEnv("RAG_CONTEXT_TOKEN_BUDGET", "1500");
    expect(getContextTokenBudget()).toBe(1500);
  });

  it.each(["0", "-5", "abc", "12.5"])("throws on invalid value %s", (value) => {
    vi.stubEnv("RAG_CONTEXT_TOKEN_BUDGET", value);
    expect(() => getContextTokenBudget()).toThrow(/RAG_CONTEXT_TOKEN_BUDGET/);
  });
});

describe("countTokens", () => {
  it("counts more tokens for longer text", () => {
    expect(countTokens("hello world")).toBeGreaterThan(0);
    expect(countTokens("hello world hello world")).toBeGreaterThan(countTokens("hello world"));
  });
});
