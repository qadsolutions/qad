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

### Negative probes

Questions the corpus does **not** answer, with their top-1 cosine similarity. Split into
*far* (clearly out-of-domain) and *near* (adjacent home-services the corpus doesn't cover
— the hard case for a threshold):

| Probe | Kind | Question | Top similarity |
|---|---|---|---|
| `nq-taxes` | far | "Can you help me file my income taxes this year?" | 0.506 |
| `nq-petsitting` | far | "Do you offer pet sitting or dog boarding services?" | 0.566 |
| `nq-electrical` | near | "Can you rewire the electrical panel in my house?" | 0.566 |
| `nq-plumbing` | near | "Do you do plumbing repairs like fixing a leaky faucet?" | 0.641 |

> **Note for the relevance-threshold work (#97):** even clearly off-topic queries score
> ~0.51–0.57, and the near-domain `nq-plumbing` reaches **0.641** — `nomic-embed-text`
> produces a high similarity floor, so a naive `RAG_MIN_SIMILARITY` cutoff in the 0.5s
> would **not** reliably reject these false matches without also risking real ones. The
> near probes (0.57–0.64) are the band the threshold must thread; tune it against both
> this positive baseline and these negatives — this harness is how to do it.

## Interpreting changes

- A drop in recall@k or hit-rate@k after a model/chunking change is a regression in
  retrieval quality — investigate before merging.
- The runner asserts only a coarse floor (`hit-rate@5 ≥ 0.5`) so it catches gross
  breakage locally without being a flaky strict gate. The numbers above are the real
  bar; update this table when the corpus or model intentionally changes.
