import { describe, expect, it } from "vitest";
import {
  aggregate,
  formatReport,
  scoreQuestion,
  type GoldenQuestion,
} from "@/lib/rag/eval-metrics";

const q = (expectedChunkIds: string[]): GoldenQuestion => ({
  id: "q1",
  question: "q?",
  expectedChunkIds,
});

describe("scoreQuestion", () => {
  it("full hit: every expected chunk is in the top-k", () => {
    const s = scoreQuestion(q(["a", "b"]), ["a", "x", "b"], 5);
    expect(s.hitCount).toBe(2);
    expect(s.recall).toBe(1);
    expect(s.hit).toBe(true);
  });

  it("partial hit: some expected chunks present", () => {
    const s = scoreQuestion(q(["a", "b"]), ["a", "x", "y"], 5);
    expect(s.hitCount).toBe(1);
    expect(s.recall).toBe(0.5);
    expect(s.hit).toBe(true);
  });

  it("miss: no expected chunk retrieved", () => {
    const s = scoreQuestion(q(["a"]), ["x", "y"], 5);
    expect(s.hitCount).toBe(0);
    expect(s.recall).toBe(0);
    expect(s.hit).toBe(false);
  });

  it("only counts hits within the top-k cutoff", () => {
    // Expected "b" is at rank 3 (index 2); with k=2 it falls outside the cutoff.
    const s = scoreQuestion(q(["b"]), ["x", "y", "b"], 2);
    expect(s.retrievedTopK).toEqual(["x", "y"]);
    expect(s.hit).toBe(false);
    expect(s.recall).toBe(0);
  });

  it("throws on a non-positive k", () => {
    expect(() => scoreQuestion(q(["a"]), ["a"], 0)).toThrow(/k must be a positive integer/);
  });

  it("throws on a non-integer k", () => {
    expect(() => scoreQuestion(q(["a"]), ["a"], 2.5)).toThrow(/k must be a positive integer/);
  });

  it("throws when scoring a negative probe (no expected chunks)", () => {
    expect(() => scoreQuestion(q([]), ["a"], 5)).toThrow(/negative probes are not scored/);
  });
});

describe("aggregate", () => {
  it("computes mean recall@k and hit-rate@k across questions", () => {
    const k = 3;
    const scored = [
      scoreQuestion({ id: "a", question: "?", expectedChunkIds: ["a"] }, ["a"], k), // recall 1, hit
      scoreQuestion({ id: "b", question: "?", expectedChunkIds: ["b1", "b2"] }, ["b1"], k), // recall .5, hit
      scoreQuestion({ id: "c", question: "?", expectedChunkIds: ["c"] }, ["x"], k), // recall 0, miss
    ];
    const report = aggregate(scored, k);

    expect(report.questionCount).toBe(3);
    expect(report.meanRecallAtK).toBeCloseTo((1 + 0.5 + 0) / 3, 6);
    expect(report.hitRateAtK).toBeCloseTo(2 / 3, 6);
    expect(report.k).toBe(3);
  });

  it("returns zeros for an empty set without dividing by zero", () => {
    const report = aggregate([], 5);
    expect(report.meanRecallAtK).toBe(0);
    expect(report.hitRateAtK).toBe(0);
    expect(report.questionCount).toBe(0);
  });
});

describe("formatReport", () => {
  it("renders aggregate percentages and a per-question HIT/MISS line", () => {
    const k = 5;
    const scored = [
      scoreQuestion({ id: "hit-q", question: "answered?", expectedChunkIds: ["a"] }, ["a"], k),
      scoreQuestion({ id: "miss-q", question: "unanswered?", expectedChunkIds: ["b"] }, ["x"], k),
    ];
    const text = formatReport(aggregate(scored, k));

    expect(text).toContain("mean recall@5: 50.0%");
    expect(text).toContain("hit-rate@5: 50.0%");
    expect(text).toContain("[HIT ] hit-q");
    expect(text).toContain("[MISS] miss-q");
  });
});
