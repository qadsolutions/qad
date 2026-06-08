# TODOS

Deferred work tracked here. Each item includes context so it can be picked up months later.

---

## TODO-1: Document the Groq to Ollama data handover boundary

**What:** Write an explicit rule defining:
- What data is allowed to flow through Groq API (synthetic/fabricated test data only)
- What event triggers the switch to Ollama production (first real client document ingested)
- How to verify the switch happened (check INFERENCE_PROVIDER env var, confirm no Groq key in prod)

**Why:** The no-real-data policy for Groq exists as a decision from the engineering review.
Without it written down, a collaborator can accidentally paste a real prospect's pricing sheet
into the dev environment and violate the core privacy guarantee.

**Depends on:** D2 decision captured in CLAUDE.md (Groq prototype with no-real-data policy).

**Do before:** M1 development begins.

---

## TODO-2: Design the embedding model upgrade workflow

**What:** Define the operational procedure for upgrading the embedding model in the future.
The procedure needs:
- How to re-embed all existing chunks for all tenants without downtime
- How the model_version field on the embeddings table is used during transition
- Whether old and new vectors can co-exist during migration
- What happens to queries during a re-embedding job

**Why:** Changing embedding models makes all existing vectors incompatible with new query embeddings.
You cannot mix nomic-embed-text vectors with a different model in the same similarity search.
Without a tested procedure, upgrading the model is a high-risk data operation.

**Depends on:** M3 completion (embeddings table and ingestion pipeline must exist first).

**Do before:** Signing Tenant 2.
