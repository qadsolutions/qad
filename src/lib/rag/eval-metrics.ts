/**
 * Retrieval-quality metrics for the eval harness (issue #85).
 *
 * Pure scoring over (expected chunk ids) vs (retrieved chunk ids, best-first). No DB,
 * no network: the harness (`tests/eval/retrieval-eval.test.ts`) supplies the retrieved
 * ids from the real M4 retrieval path and these functions score them — so the math is
 * unit-tested in CI without needing Ollama.
 *
 * Metrics (computed at a cutoff k):
 *   - recall@k   per question = |expected ∩ retrieved_topk| / |expected|.
 *   - hit@k      per question = at least one expected id is in retrieved_topk.
 *   - mean recall@k / hit-rate@k = the per-question values averaged over the set.
 *
 * Negative questions (no expected chunks) are NOT scored here — they measure
 * false-match behaviour, which belongs to the relevance-threshold work (#97). The
 * harness reports their top similarity separately.
 */

export interface GoldenQuestion {
  /** Stable id for reporting (e.g. "q-hours"). */
  id: string;
  question: string;
  /** Chunk ids that SHOULD appear in the top-k. Must be non-empty for scoring. */
  expectedChunkIds: string[];
}

export interface ScoredQuestion {
  id: string;
  question: string;
  expectedChunkIds: string[];
  /** Retrieved chunk ids the question was scored against, truncated to k, best-first. */
  retrievedTopK: string[];
  /** |expected ∩ retrievedTopK|. */
  hitCount: number;
  /** hitCount / |expected| ∈ [0, 1]. */
  recall: number;
  /** hitCount > 0. */
  hit: boolean;
}

export interface EvalReport {
  k: number;
  questionCount: number;
  /** Mean of per-question recall@k ∈ [0, 1]. */
  meanRecallAtK: number;
  /** Fraction of questions with at least one expected chunk in the top-k ∈ [0, 1]. */
  hitRateAtK: number;
  questions: ScoredQuestion[];
}

/**
 * Score one golden question against the chunk ids retrieval returned (any length;
 * truncated to `k` here, best-first). Throws on an empty `expectedChunkIds` — a
 * question with nothing to find is a negative probe and must not be scored.
 */
export function scoreQuestion(
  question: GoldenQuestion,
  retrievedChunkIds: string[],
  k: number,
): ScoredQuestion {
  if (!Number.isInteger(k) || k <= 0) {
    throw new Error(`k must be a positive integer, got ${JSON.stringify(k)}`);
  }
  if (question.expectedChunkIds.length === 0) {
    throw new Error(
      `scoreQuestion: "${question.id}" has no expectedChunkIds — negative probes are not scored here`,
    );
  }

  const retrievedTopK = retrievedChunkIds.slice(0, k);
  const found = new Set(retrievedTopK);
  const hitCount = question.expectedChunkIds.filter((id) => found.has(id)).length;

  return {
    id: question.id,
    question: question.question,
    expectedChunkIds: question.expectedChunkIds,
    retrievedTopK,
    hitCount,
    recall: hitCount / question.expectedChunkIds.length,
    hit: hitCount > 0,
  };
}

/** Aggregate per-question scores into mean recall@k and hit-rate@k. */
export function aggregate(scored: ScoredQuestion[], k: number): EvalReport {
  const questionCount = scored.length;
  const meanRecallAtK =
    questionCount === 0 ? 0 : scored.reduce((sum, q) => sum + q.recall, 0) / questionCount;
  const hitRateAtK =
    questionCount === 0 ? 0 : scored.filter((q) => q.hit).length / questionCount;

  return { k, questionCount, meanRecallAtK, hitRateAtK, questions: scored };
}

/** Render an {@link EvalReport} as a human-readable table for on-demand runs. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`Retrieval-quality eval @k=${report.k}  (${report.questionCount} questions)`);
  lines.push(
    `  mean recall@${report.k}: ${(report.meanRecallAtK * 100).toFixed(1)}%   ` +
      `hit-rate@${report.k}: ${(report.hitRateAtK * 100).toFixed(1)}%`,
  );
  lines.push("");
  for (const q of report.questions) {
    const mark = q.hit ? "HIT " : "MISS";
    lines.push(
      `  [${mark}] ${q.id}: recall ${(q.recall * 100).toFixed(0)}% ` +
        `(${q.hitCount}/${q.expectedChunkIds.length}) — "${q.question}"`,
    );
  }
  return lines.join("\n");
}

/** One negative probe's outcome: its reason tag and top-1 retrieval similarity. */
export interface NegativeProbeResult {
  id: string;
  reason: string;
  /** Top-1 similarity from retrieval; null when retrieval returned no rows at all. */
  topSimilarity: number | null;
}

export interface NegativeReasonSummary {
  reason: string;
  /** Probes in this group, including any that retrieved no rows. */
  count: number;
  /** Stats over the group's non-null similarities; null when the group has none. */
  minSimilarity: number | null;
  meanSimilarity: number | null;
  maxSimilarity: number | null;
}

/**
 * Group negative probes by their tagged reason and summarise the top-1 similarity
 * distribution per reason — the calibration input for the relevance threshold (#97).
 * Reasons appear in first-seen order. A `null` similarity (no rows retrieved) is still
 * counted but excluded from the stats, so "refused outright" and "matched something"
 * stay distinct.
 *
 * The reason tag is what lets a later assertion credit a refusal only when it fires for
 * the right reason: an out-of-domain miss, an underspecified question, and a false
 * premise all surface as the same no-context response but are different behaviours.
 */
export function summarizeNegativesByReason(probes: NegativeProbeResult[]): NegativeReasonSummary[] {
  const order: string[] = [];
  const sims = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const probe of probes) {
    if (!sims.has(probe.reason)) {
      sims.set(probe.reason, []);
      counts.set(probe.reason, 0);
      order.push(probe.reason);
    }
    counts.set(probe.reason, counts.get(probe.reason)! + 1);
    if (probe.topSimilarity !== null) sims.get(probe.reason)!.push(probe.topSimilarity);
  }
  return order.map((reason) => {
    const values = sims.get(reason)!;
    const count = counts.get(reason)!;
    if (values.length === 0) {
      return { reason, count, minSimilarity: null, meanSimilarity: null, maxSimilarity: null };
    }
    return {
      reason,
      count,
      minSimilarity: Math.min(...values),
      meanSimilarity: values.reduce((sum, v) => sum + v, 0) / values.length,
      maxSimilarity: Math.max(...values),
    };
  });
}

/** Render the per-reason negative summary for on-demand runs. */
export function formatNegativeSummary(summaries: NegativeReasonSummary[]): string {
  const lines = ["Negative probes — top-1 similarity by reason (calibration for #97):"];
  for (const s of summaries) {
    const stat =
      s.meanSimilarity === null
        ? "no rows retrieved"
        : `min ${s.minSimilarity!.toFixed(3)}  mean ${s.meanSimilarity.toFixed(3)}  max ${s.maxSimilarity!.toFixed(3)}`;
    lines.push(`  ${s.reason} (n=${s.count}): ${stat}`);
  }
  return lines.join("\n");
}
