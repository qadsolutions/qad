# ROADMAP — QAD Solutions

Production build timeline for the private multi-tenant RAG platform.
Each milestone maps to a GitHub Milestone. Update the status column when a milestone ships.

---

## Milestone Status

| Milestone | Name | Target | Status |
|---|---|---|---|
| M1 | Auth + Tenant Model | Week 1 | 🔲 Pending |
| M2 | PostgreSQL Schema + pgvector | Week 2 | 🔲 Pending |
| M3 | Document Ingestion Pipeline | Week 3–4 | 🔲 Pending |
| M4 | Vector Search + RAG Endpoint | Week 5–6 | 🔲 Pending |
| M5 | Ollama Inference + Streaming | Week 7 | 🔲 Pending |
| M6 | Client Portal | Week 8–9 | 🔲 Pending |
| M7 | Owner Admin Dashboard | Week 10–11 | 🔲 Pending |
| M8 | E2E Testing + Playwright | Week 12 | 🔲 Pending |
| M9 | Audit Trail + Monitoring | Week 13 | 🔲 Pending |
| M10 | Production Deploy + Hardening | Week 14–16 | 🔲 Pending |

Status key: 🔲 Pending · 🟡 In Progress · ✅ Complete · ❌ Blocked

---

## Production Timeline

```mermaid
gantt
    title QAD Solutions — Build Timeline
    dateFormat  YYYY-MM-DD
    axisFormat  %b %d

    section Foundation
    M1 Auth + Tenant Model           :m1, 2025-07-01, 7d
    M2 Database Schema + pgvector    :m2, after m1, 7d

    section Core RAG
    M3 Document Ingestion Pipeline   :m3, after m2, 14d
    M4 Vector Search + RAG Endpoint  :m4, after m3, 14d
    M5 Ollama Inference + Streaming  :m5, after m4, 7d

    section Product
    M6 Client Portal                 :m6, after m5, 14d
    M7 Owner Admin Dashboard         :m7, after m6, 14d

    section Hardening
    M8 E2E Testing + Playwright      :m8, after m7, 7d
    M9 Audit Trail + Monitoring      :m9, after m8, 7d
    M10 Production Deploy            :m10, after m9, 14d
```

---

## Milestone Details

### M1 — Auth + Tenant Model (Week 1)

Exit criterion: Tenant A JWT cannot retrieve any Tenant B chunks under any condition.

- [ ] Supabase Auth configured with JWT containing `tenant_id` claim
- [ ] `tenants` table with `id`, `name`, `slug`, `created_at`
- [ ] `users` table with `tenant_id` foreign key
- [ ] RLS policies: users can only read rows where `tenant_id` matches their JWT claim
- [ ] API middleware extracts and validates `tenant_id` from JWT on every request
- [ ] `tests/integration/tenant-isolation.test.ts` written and passing
- [ ] TypeScript strict mode enabled

---

### M2 — PostgreSQL Schema + pgvector (Week 2)

- [ ] `pgvector` extension enabled in Supabase
- [ ] `documents` table: `id`, `tenant_id`, `name`, `status`, `source_url`, `created_at`, `updated_at`
- [ ] `document_chunks` table: `id`, `document_id`, `tenant_id`, `content`, `token_count`, `chunk_index`
- [ ] `embeddings` table: `id`, `chunk_id`, `tenant_id`, `embedding vector(768)`, `model_version`
- [ ] HNSW index: `CREATE INDEX ON embeddings USING hnsw (embedding vector_cosine_ops) WITH (ef_construction=64, m=16)`
- [ ] RLS policies on all three tables (tenant_id isolation)
- [ ] All migrations tracked in `supabase/migrations/`

---

### M3 — Document Ingestion Pipeline (Week 3–4)

- [ ] `POST /api/documents/upload` — accepts PDF, DOCX, TXT, MD; returns `202 Accepted` immediately
- [ ] `documents.status` lifecycle: `uploading → processing → ready → error`
- [ ] Background job: parse → chunk (512 tokens, 64 overlap) → embed (nomic-embed-text) → store
- [ ] Error state written back to `documents.status` if any step fails
- [ ] `GET /api/documents/:id/status` endpoint for polling
- [ ] Max file size enforced (env: `MAX_FILE_SIZE_BYTES`)
- [ ] Vitest integration tests for ingestion pipeline

---

### M4 — Vector Search + RAG Endpoint (Week 5–6)

- [ ] `POST /api/query` — accepts `{ question: string }` from authenticated tenant user
- [ ] Embed question with same model as documents (nomic-embed-text)
- [ ] pgvector similarity search filtered by `tenant_id` (top-k from env: `RAG_TOP_K`)
- [ ] Prompt construction: system prompt + retrieved chunks + user question
- [ ] Response returned to client
- [ ] `retrieval_logs` table: `query`, `chunk_ids`, `tenant_id`, `latency_ms`, `created_at`
- [ ] Cross-tenant isolation test must still pass after this milestone

---

### M5 — Ollama Inference + Streaming (Week 7)

- [ ] Vercel AI SDK streaming connected to Ollama via Cloudflare Tunnel
- [ ] `INFERENCE_PROVIDER=ollama` configured, Groq removed from production path
- [ ] Streamed response via SSE to browser
- [ ] `model_calls` table: `tenant_id`, `model`, `prompt_tokens`, `completion_tokens`, `latency_ms`, `created_at`
- [ ] Switch from Groq to Ollama verified: no real client data ever sent to Groq

---

### M6 — Client Portal (Week 8–9)

- [ ] Login page (Supabase Auth)
- [ ] Chat interface with streaming responses
- [ ] Document upload UI with status polling
- [ ] Document list with status indicators (processing / ready / error)
- [ ] Session persistence

---

### M7 — Owner Admin Dashboard (Week 10–11)

- [ ] Tenant management (create, edit, deactivate)
- [ ] Per-tenant document and usage overview
- [ ] Query and retrieval logs viewer
- [ ] Model usage and cost tracking
- [ ] User management per tenant

---

### M8 — E2E Testing + Playwright (Week 12)

- [ ] Playwright installed and configured
- [ ] E2E test: document upload → processing → ready → query → response
- [ ] E2E test: login → chat → logout
- [ ] E2E test: admin creates tenant → tenant user logs in
- [ ] CI Playwright job added to `.github/workflows/ci.yml`

---

### M9 — Audit Trail + Monitoring (Week 13)

- [ ] `audit_logs` table: `user_id`, `tenant_id`, `action`, `resource_type`, `resource_id`, `ip_address`, `created_at`
- [ ] INSERT-only RLS on `audit_logs` — no UPDATE or DELETE by any tenant role
- [ ] All API routes write audit entries
- [ ] 90-day retention policy documented
- [ ] Basic error alerting configured (Vercel or Supabase dashboards)

---

### M10 — Production Deploy + Hardening (Week 14–16)

- [ ] Vercel Pro project configured (60s function timeout)
- [ ] All environment variables set in Vercel dashboard (not `.env.local`)
- [ ] Supabase production project (separate from dev)
- [ ] Custom domain configured
- [ ] Branch protection rules enabled on `main` and `dev`
- [ ] Final security review: OWASP checklist, NEXT_PUBLIC_ audit, RLS policy review
- [ ] Soft launch with first paying client

---

## Release Tags

| Tag | Milestone | Notes |
|---|---|---|
| v0.4.0 | M4 | RAG endpoint working end-to-end |
| v0.7.0 | M7 | Full product with admin dashboard |
| v0.10.0 | M10 | Production launch |
