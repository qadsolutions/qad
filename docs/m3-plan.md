# M3 — Document Ingestion Pipeline: build plan & decisions

Working plan for Milestone 3 (issues #23–#27). Source of truth for scope/sequence
remains the GitHub Milestones; this captures the dependency analysis and the
decisions locked on 2026-06-20.

## Issues

| # | Title | Needs Ollama? | Layer |
|---|---|---|---|
| #23 | Upload endpoint `POST /api/documents/upload` (validate, store, 202) | No | HTTP / Storage |
| #24 | Document parsers (PDF/DOCX/TXT/MD → text) | No | Parsing lib |
| #25 | Chunking + Ollama embedding + bulk insert | Yes | Embedding lib |
| #26 | Background worker (status, re-ingestion, errors) | No | Orchestration |
| #27 | Ingestion tests (file types, limits, partial failure) | Yes | Tests |

## Dependency graph

```
M2 (documents, chunks, embeddings, Storage — done)
        │
        ├── #23 Upload endpoint ──────────────────┐ (calls the worker trigger)
        ├── #24 Parsers ───────────┐              │
        └── #25 Chunk + embed ─────┴──► #26 Worker ──► #27 Ingestion tests
```

- **Parallel (Wave 1):** #23, #24, #25 — separate dirs, no shared code.
- **Integration (Wave 2):** #26 — needs #24 + #25; wires #23's trigger.
- **Verification (Wave 3):** #27 — needs the whole pipeline.
- **Critical path:** #24/#25 → #26 → #27 (~5 working days with parallelism).

## Wave 0 — interfaces to lock before Wave 1
- `parse(buffer, fileType) → { text }` (#24 output → #25 input)
- `ingestDocument(documentId) → Promise<void>` (worker entrypoint #23 triggers, #26 implements)
- `embed(texts: string[]) → Promise<number[][]>` (768-dim; see Decision 2)

## Locked decisions (2026-06-20)

### D1 — Re-ingestion is a single DB transaction (#26)
"Delete ALL old chunks+embeddings for a `document_id`, then insert the new set"
runs inside **one transaction**. A mid-failure must roll back to the prior good
state — never leave a half-wiped document. Status flips to `ready` only after the
transaction commits; any failure → status `error` with detail, old data intact.

### D2 — Mock the embedder in CI; real-Ollama smoke test runs locally (#25/#27)
Build #25 behind the `embed()` interface with two implementations:
- **Ollama embedder** — POSTs `${OLLAMA_EMBED_URL}/api/embeddings` with
  `model = EMBEDDING_MODEL`; rejects any vector whose length ≠ 768 before insert
  (pairs with the DB `vector(768)` column to fail fast).
- **Fake/deterministic embedder** — hashes text → reproducible 768-dim vector, no
  network. Selected in tests/CI via the existing `INFERENCE_PROVIDER=mock` test env.

CI gets no Ollama service (confirmed: `ci.yml` provisions only `pgvector/pgvector:pg16`).
A real-Ollama integration smoke test asserts 768 dims but **auto-skips** when
`localhost:11434` / the model is unreachable, so it never breaks CI.

### D3 — Retrieval-quality eval lands in M4, not M3
A golden-set eval (real questions → expected documents, scored by recall/hit-rate,
re-runnable when the embedding model or chunking changes) is the right way to judge
embedding quality — *not* CI. It needs a stable top-k retrieval function to score,
which M4 (RAG Query Endpoint) delivers; building it against raw `<=>` queries in M3
would be thrown away when M4 formalizes retrieval. **Tracked as a new M4 issue.**
The golden-set *fixture* (questions → expected docs) is content, not code, so
curation can begin during M3 so the harness is ready as soon as M4 retrieval exists.

## Embedder completion checklist (front half of #25; shared with #27)
1. `src/lib/ingestion/embedder.ts` — `embed()` interface + env-driven factory
2. Ollama implementation (768-dim validation)
3. Fake/deterministic implementation (CI/tests)
4. Selection rule: fake when `INFERENCE_PROVIDER=mock`/test or `OLLAMA_EMBED_URL` unset; real otherwise
5. Real-Ollama smoke test that self-skips when unreachable
6. Docs: note `ollama pull nomic-embed-text` in dev bootstrap (a fresh clone lacks it)
7. Dimension guard: reject length ≠ 768 before insert

## Ollama status (2026-06-20)
- **Local:** `qad-ollama` up on `:11434`; `nomic-embed-text` pulled (274 MB);
  verified live call returns **768 dims**, deterministic. Local dev unblocked.
- **CI:** no Ollama (by design) → embedder is mocked there (D2).
- **Prototype/prod:** `OLLAMA_EMBED_URL` repoints to a Cloudflare Tunnel (demo) or a
  private GPU box (production, M10). Clients never call Ollama directly — it's a
  server-side step. Model stays `nomic-embed-text` (768-dim) to avoid re-embedding
  every document; a model change later triggers a full re-embed (and a D3 eval run).

## Risks
1. **Re-ingestion atomicity** — addressed by D1 (single transaction).
2. **Ollama availability** — addressed by D2 (mock in CI + local smoke test).
