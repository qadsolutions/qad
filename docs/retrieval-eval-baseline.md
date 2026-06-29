# Retrieval-quality eval — baseline

A re-runnable quality signal for the M4 retrieval path (issue #85). It measures how
well tenant-filtered vector search (`match_chunks`, #28) surfaces the *right* chunk for
a question — separate from CI correctness, which only proves isolation and wiring.

This is **not a CI gate.** It runs only where a real Ollama embedding model is available
— your local machine or a GPU host (`nomic-embed-text` on `localhost:11434`). CI runners
have no Ollama, so the harness self-skips there rather than failing (it needs both a
reachable Ollama and `DATABASE_URL`). Run it locally — on demand, or whenever the
embedding model or chunking strategy changes — and compare against the baseline below.

## What it does

1. Seeds the synthetic golden set (`tests/eval/golden-set.ts`) — a fabricated
   home-services knowledge base (12 chunks across 3 documents) for one tenant — into the
   pgvector test DB.
2. Embeds every chunk with real Ollama `nomic-embed-text` (768-dim) and inserts the
   vectors.
3. Embeds each golden question, runs it through `match_chunks` (tenant-scoped, top-k),
   and scores:
   - **recall@k** — fraction of a question's expected chunks found in the top-k.
   - **hit-rate@k** — fraction of questions with at least one expected chunk in the top-k.
4. Prints a per-question HIT/MISS table plus the aggregate, and reports the top
   similarity for a few **negative probes** (questions the corpus does not answer).

Metric math lives in `src/lib/rag/eval-metrics.ts` and is unit-tested in CI
(`tests/unit/rag-eval-metrics.test.ts`); only the live embedding run needs Ollama.

## How to run

```bash
# Requires local Ollama (nomic-embed-text pulled) + Docker for the pgvector test DB.
pnpm eval:retrieval
```

The script starts the `qad-test-db` container (via `scripts/ensure-test-db.mjs`), runs
only the eval, and passes `--disableConsoleIntercept` so the report table prints (vitest
swallows console output by default).

## Baseline

| Field | Value |
|---|---|
| Date recorded | 2026-06-27 |
| Embedding model | `nomic-embed-text` (768-dim, Ollama) |
| Retrieval | `match_chunks`, `hnsw.ef_search = 100`, cosine |
| k (`RAG_TOP_K`) | 5 |
| Golden questions | 13 (1 expected chunk each) |
| **mean recall@5** | **100.0%** |
| **hit-rate@5** | **100.0%** |

All 13 questions retrieved their expected chunk within the top 5.

### Negative probes — by refusal reason

Questions the corpus does **not** answer, each tagged by *why* it's unanswerable. They all
surface as the same no-context response but are different behaviours, so the eval tags
them — and a later abstention assertion must credit a refusal only when it fires for the
**right reason**. Otherwise a refuse-everything system passes the whole negative set while
quietly tanking the answerable one.

| Probe | Reason | Question | Top similarity |
|---|---|---|---|
| `nq-taxes` | out_of_domain | "Can you help me file my income taxes this year?" | 0.506 |
| `nq-petsitting` | out_of_domain | "Do you offer pet sitting or dog boarding services?" | 0.566 |
| `nq-electrical` | out_of_domain | "Can you rewire the electrical panel in my house?" | 0.566 |
| `nq-plumbing` | out_of_domain | "Do you do plumbing repairs like fixing a leaky faucet?" | 0.641 |
| `nq-vague-cost` | underspecified | "How much will it cost?" | 0.630 |
| `nq-availability` | underspecified | "Can you come out?" | 0.497 |
| `nq-membership` | false_premise | "How do I sign up for your monthly membership plan?" | 0.554 |
| `nq-loyalty` | false_premise | "How do I redeem my 20% loyalty discount?" | 0.566 |

Top-1 similarity distribution by reason:

| Reason | n | min | mean | max |
|---|---|---|---|---|
| out_of_domain | 4 | 0.506 | 0.570 | 0.641 |
| underspecified | 2 | 0.497 | 0.563 | 0.630 |
| false_premise | 2 | 0.554 | 0.560 | 0.566 |

> **Threshold-calibration finding (for #97):** all three reason groups overlap in the
> ~0.50–0.64 band, and the hardest negatives (`nq-plumbing` 0.641, `nq-vague-cost` 0.630)
> sit right where real answerable questions also score. `nomic-embed-text` has a high
> similarity floor, so **no single global `RAG_MIN_SIMILARITY` cutoff cleanly separates
> answerable from unanswerable** — dropping it far enough to reject these would also reject
> real matches. That's the load-bearing signal this harness exists to surface.

#### Scoring abstention by reason, not just "did it refuse"

Asserting that the answer path actually **refuses for the tagged reason** lands with the
relevance threshold (#97) and the answer endpoint (#30); this retrieval-only eval supplies
the per-reason distribution they calibrate against. Abstention is scored here directly
rather than via an off-the-shelf faithfulness metric, because those return **NaN on a
correct refusal** — there are no grounded claims to score — so a passing refusal reads as a
hole in the dashboard rather than a pass. The load-bearing parts (tagging *why* each
negative is unanswerable, plus the per-reason similarity distribution) are owned here
regardless of tooling.

## Interpreting changes

- A drop in recall@k or hit-rate@k after a model/chunking change is a regression in
  retrieval quality — investigate before merging.
- The runner asserts only a coarse floor (`hit-rate@5 ≥ 0.5`) so it catches gross
  breakage locally without being a flaky strict gate. The numbers above are the real
  bar; update this table when the corpus or model intentionally changes.
