# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Objective

Build a private, multi-tenant RAG (Retrieval-Augmented Generation) platform for
small service businesses. Each client gets a secure isolated workspace and AI agent
grounded in their own knowledge. The owner controls everything from a central admin
dashboard. No client data touches public LLM APIs in production.

See `business_description.md` for the business model and go-to-market context.
See `design.md` for the full product design and discovery session output.
See `Final Report QAD Solutions.docx.pdf` for the complete architecture specification.

---

## Stack (Decided — do not change without an eng review)

| Layer | Technology | Status |
|---|---|---|
| Frontend | Next.js 14+ (TypeScript, React, Tailwind CSS) | Not built yet |
| Backend API | Next.js API Routes on Vercel Serverless (Pro tier) | Not built yet |
| Database | Supabase (PostgreSQL 16 + pgvector + Auth + Storage) | Not set up yet |
| Auth | Supabase Auth (JWT with tenant_id + role claims) | Not set up yet |
| Vector store | pgvector inside Supabase (HNSW index) | Not set up yet |
| Embeddings | Ollama nomic-embed-text (768-dim, local) | Running — localhost:11434 |
| Inference (prototype) | Groq API (Llama 3.3 70B, free tier) — synthetic data ONLY | Available |
| Inference (production) | Ollama + vLLM on private GPU server | Not provisioned yet |
| Deployment | Vercel Pro (auto-deploys on push to main) | Not configured yet |
| Demo tunnel | Cloudflare Tunnel pointing to local Ollama | Not configured yet |
| Workflow automations | n8n — deferred, out of scope through M10 | Running — localhost:5678 |
| Containerization | Docker (local dev infra: Ollama + n8n) | Running |
| AI SDK | Vercel AI SDK (OpenAI-compatible, handles streaming) | Not installed yet |
| Testing | Vitest + Playwright + Supertest | Not set up yet |

### TypeScript requirement

All code MUST use `strict: true` in `tsconfig.json`. Non-negotiable.
`create-next-app` sets this by default — do not remove it.

---

## Security Rules (non-negotiable)

### Supabase key naming — CRITICAL

Supabase provides two keys with completely different security properties:

| Key | Env var name | Can use in browser? | Notes |
|---|---|---|---|
| anon key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | YES — designed to be public | Works only within RLS policies |
| service_role key | `SUPABASE_SERVICE_ROLE_KEY` | **NEVER** — bypasses ALL RLS | Server-side API routes only |

**The service_role key must NEVER have a `NEXT_PUBLIC_` prefix.**
If it is named with `NEXT_PUBLIC_`, it is bundled into client JavaScript and visible to every
user in browser DevTools. This collapses the entire tenant isolation model.

### Groq API — synthetic data only

Groq API sends query context to Groq's external servers. This violates the core privacy guarantee.

**Rule:** Groq may only be used with synthetic or fabricated test data.
Real business documents, pricing sheets, or SOPs must NEVER be ingested while `INFERENCE_PROVIDER=groq`.

The switch to Ollama production occurs before any real client data is loaded.
Set `INFERENCE_PROVIDER=ollama` and point `OLLAMA_BASE_URL` to the Cloudflare Tunnel for all real-data use.

### Tenant isolation — enforced at two layers

1. **Database layer:** RLS policies on every Supabase table filter by `auth.jwt()->>'tenant_id'`
2. **API layer:** Tenant middleware validates `tenant_id` from JWT on every API route before any DB query

The cross-tenant isolation integration test is a **M1 exit criterion.**
M1 is not complete until this test passes on CI. Because the isolation mechanism
(`JWT tenant_id` claim → RLS filter) is identical across all tenant-scoped tables, the M1
test proves it on the tables that exist in M1: create Tenant A and Tenant B, seed each with
its own user(s), query `users` using Tenant A credentials, assert zero Tenant B rows (and
vice versa). The documents/chunks-specific isolation test moves to M2, once those tables
exist (tracked as a separate M2 issue).

---

## Infrastructure Commands (local dev)

### Start local dev services
```bash
docker compose up -d
```

### Stop all services
```bash
docker compose down
```

### View logs
```bash
docker compose logs -f         # all services
docker compose logs -f ollama  # specific service
```

### Pull models (first time or after volume wipe)
```bash
docker exec qad-ollama ollama pull nomic-embed-text
docker exec qad-ollama ollama pull llama3.2
```

### Check available models
```bash
docker exec qad-ollama ollama list
```

### Local service endpoints

| Service | URL | Credentials |
|---|---|---|
| Ollama (inference + embeddings) | http://localhost:11434 | no auth |
| n8n (deferred) | http://localhost:5678 | admin / Qad_secure_pass1 |

> `N8N_ENCRYPTION_KEY` must not change after first n8n run — it decrypts stored credentials.
> Local PostgreSQL (localhost:5433) is for local dev only. Supabase is the production database.

---

## Architecture

### Core Data Flow

```
Client submits question in Client Portal
  → Next.js API Route (Vercel Serverless)
  → Auth Middleware: validate JWT, extract tenant_id + role
  → Tenant Validator: confirm user has query permission for this tenant
  → RAG Engine: generate embedding for question (Ollama nomic-embed-text)
  → pgvector: similarity search filtered strictly by tenant_id (HNSW index)
  → RAG Engine: construct prompt (system instructions + retrieved chunks + question)
  → Inference server: stream response (Groq prototype / Ollama production)
  → Vercel AI SDK: stream tokens to browser via Server-Sent Events
  → Audit Logger: record user_id, tenant_id, question, chunk_ids, response, timestamp
```

### Document Ingestion Pipeline (async — IMPORTANT)

**Upload returns 202 Accepted immediately.** Chunking and embedding run in a background process.
The `documents` table tracks status: `uploading | processing | ready | error`.

```
POST /api/documents/upload
  → Validate file type (PDF, DOCX, TXT, MD) and size (max 50MB)
  → Store raw file in Supabase Storage
  → Create document record with status: processing
  → Return 202 Accepted + document_id

Background process:
  → Parse document (pdfjs-dist for PDF, mammoth.js for DOCX)
  → Chunk by token count with overlap
  → For each chunk: call Ollama nomic-embed-text → 768-dim vector
  → Bulk insert into document_chunks + embeddings (with tenant_id)
  → Update document status: ready
  → On any failure: update status: error, log error detail
```

Re-ingestion on document update: delete ALL old chunks and embeddings for that document_id
before inserting new ones. Orphaned old vectors cause stale chunks in retrieval.

### pgvector Index

Use HNSW, not IVFFlat. Add this to the M2 migration:

```sql
CREATE INDEX ON embeddings USING hnsw (embedding vector_cosine_ops)
WITH (ef_construction = 64, m = 16);
```

HNSW handles dynamic datasets (documents added continuously by tenants) without requiring
VACUUM maintenance or upfront `lists` parameter tuning. IVFFlat degrades over time without it.

### Database Schema (11 tables)

| Table | Key fields |
|---|---|
| `tenants` | id, name, plan_tier, settings (JSONB), is_active |
| `users` | id, tenant_id (FK; nullable only for platform_admin — see Roles), email, role (user/admin/platform_admin) |
| `documents` | id, tenant_id (FK), filename, file_type, storage_path, version, status |
| `document_chunks` | id, document_id (FK), tenant_id (FK), chunk_text, chunk_index, token_count |
| `embeddings` | id, chunk_id (FK), tenant_id (FK), embedding (vector 768), model_version |
| `conversations` | id, user_id (FK), tenant_id (FK), created_at, title |
| `messages` | id, conversation_id (FK), tenant_id (FK), role, content, created_at |
| `retrieval_logs` | id, message_id (FK), tenant_id (FK), chunk_ids (array), similarity_scores |
| `model_calls` | id, tenant_id (FK), user_id (FK), model_name, prompt_tokens, completion_tokens, latency_ms |
| `audit_logs` | id, tenant_id (FK, **nullable** — NULL = fleet-wide platform action; see SECURITY.md §5), user_id (FK, NOT NULL — actor), action, resource_type, resource_id, ip_address, created_at |
| `settings` | id, tenant_id (FK), key, value, updated_by |

### Roles & admin model

Three roles (`users.role`), each with its own surface:

| Role | Who | Surface | Scope |
|---|---|---|---|
| `user` | Staff at a client business | Client Portal (M6) | Their tenant (RLS) — chat/query only |
| `admin` | Owner/manager of the client business | Owner Admin Dashboard (M7) | Their tenant (RLS) — manage docs, users, audit |
| `platform_admin` | Us, the operator | Platform console (M11) | All tenants, via `service_role` (never RLS) |

**Flat tenant admins:** a single `admin` role, no separate owner. Guard: the last active admin of a
tenant cannot be deactivated or demoted (lockout prevention). Enforced by a **DB trigger** — the only
layer that also fires for `service_role` writes — not UI- or API-route-only, since a `withPlatformAdmin`
route writing `users.role`/`users.is_active` via `service_role` would otherwise bypass an app-layer
check. (Deliberate full-tenant teardown during deprovisioning is a separate, explicit platform path.)
Enforced in M7.

**`platform_admin` has no tenant:** `users.tenant_id` is nullable *only* for this role, locked by two
complementary CHECKs so that `tenant_id IS NULL` ⟺ `role = 'platform_admin'`:
`CHECK (role = 'platform_admin' OR tenant_id IS NOT NULL)` (clients must have a tenant) **and**
`CHECK (role <> 'platform_admin' OR tenant_id IS NULL)` (platform admins must not — closes the
confused-deputy path). With no `tenant_id` claim they match no RLS policy (zero client rows through the
normal client). The API-layer guard `withTenant` rejects them **explicitly** — it 403s any token with
no `tenant_id` **or** role `platform_admin`. Platform routes use a separate `withPlatformAdmin` guard +
`service_role`. Both guards are defined in **SECURITY.md §3.4**.

### n8n (deferred — do not integrate before M10 / first client)

n8n is reserved for post-answer automations (scheduling handoffs, CRM updates, lead capture).
No role through M10. Do not integrate until a real client has shipped (M10) and customer discovery
validates a specific automation use case.

---

## Build Order (Milestones)

```
M1  → Auth + Tenant Model              Supabase Auth, JWT tenant_id + user_role claims, RLS policies
M2  → Database Schema + pgvector       All 11 tables, RLS, HNSW index, base API routes
M3  → Document Ingestion Pipeline      Async: upload → chunk → embed → pgvector (returns 202)
M4  → RAG Query Endpoint               Vector search, prompt builder, streaming, retrieval/model-call logs
M5  → Ollama Inference + Streaming     Provider abstraction (groq|ollama), Cloudflare Tunnel, SSE
M6  → Client Portal                    app/portal/ — chat, citations, upload UI, conversation history
M7  → Owner Admin Dashboard            app/admin/ — per-tenant doc/user mgmt, audit log, usage
M8  → E2E Testing + Playwright         Login, upload, query, admin flows
M9  → Audit Trail + Monitoring         Append-only audit_logs, 90-day retention, error alerting
M10 → Production Deploy + Hardening    Vercel Pro, private Ollama server, env hardening, first client
M11 → Platform Admin + Observability   Operator console: cross-tenant usage, pipeline diagnostics, provisioning, plan_tier
```

**M1 exit criterion:** Cross-tenant isolation integration test (on the M1 `tenants`/`users`
tables) must pass before M2 begins. The documents/chunks-level isolation test is an M2 follow-up.

> **Source of truth:** the GitHub Milestones (qadsolutions/qad, M1–M11) are authoritative for
> scope and sequencing; this list mirrors them.

**M6 + M7 can run in parallel worktrees** — `app/portal/` (Client Portal) and `app/admin/`
(Owner Admin) are separate directories with no shared code during those milestones.

---

## Testing

**Framework:** Vitest (unit + integration) + Playwright (E2E) + Supertest (API routes)

Set up Vitest at M1, not M8. The cross-tenant isolation test runs on every PR from M1 onwards.

### Protected CI Gate — do not remove

`tests/integration/tenant-isolation.test.ts` is a **required, protected file**.
CI will exit non-zero if this file is absent (hardened in #59).
Do not delete, rename, skip, or disable it. To extend coverage, add new test files alongside it.

Coverage requirements:
- Every API route: auth, tenant validation, correct error codes
- Tenant isolation: Tenant A cannot retrieve Tenant B chunks under any condition
- Document ingestion: all file types, size limits, partial failure recovery
- RAG pipeline: embedding generation, retrieval accuracy, prompt construction
- E2E: login flow, document upload + query, admin audit log review

---

## Performance Targets

| Metric | Target |
|---|---|
| First token (TTFT) | < 3 seconds |
| Full query response | < 10 seconds |
| Document ingestion (to 202 response) | < 2 seconds (async — background takes longer) |
| Vector search | < 200ms (HNSW) |
| Concurrent users (prototype) | 10 simultaneous |

---

## Environment Variables

```
# Supabase — safe to expose in browser (NEXT_PUBLIC_ prefix is correct here)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Supabase — server-only, NEVER add NEXT_PUBLIC_ prefix
SUPABASE_SERVICE_ROLE_KEY=

# Inference
INFERENCE_PROVIDER=groq        # prototype: groq | production: ollama
GROQ_API_KEY=                  # synthetic data ONLY — never use with real client data
OLLAMA_BASE_URL=               # Cloudflare Tunnel URL pointing to local Ollama

# Embeddings
EMBEDDING_MODEL=nomic-embed-text
OLLAMA_EMBED_URL=              # same as OLLAMA_BASE_URL
```

Never commit `.env`. Always update `.env.example` when adding new variables.

---

## Skill Routing

When the user's request matches an available skill, invoke it via the Skill tool.
A false positive is cheaper than a false negative.

- Product ideas, brainstorming → `/office-hours`
- Strategy, scope, "think bigger" → `/plan-ceo-review`
- Architecture, "does this design make sense" → `/plan-eng-review`
- Design system, brand → `/design-consultation`
- Design review of a plan → `/plan-design-review`
- Developer experience of a plan → `/plan-devex-review`
- Full review pipeline → `/autoplan`
- Bugs, errors, "why is this broken" → `/investigate`
- Test the site, find bugs → `/qa` (or `/qa-only` for report only)
- Code review, check the diff → `/review`
- Visual polish, design audit → `/design-review`
- Developer experience audit → `/devex-review`
- Ship, deploy, create a PR → `/ship`
- Merge + deploy + verify → `/land-and-deploy`
- Configure deployment → `/setup-deploy`
- Post-deploy monitoring → `/canary`
- Update docs after shipping → `/document-release`
- Weekly retro → `/retro`
- Second opinion → `/codex`
- Safety mode, lock it down → `/careful` or `/guard`
- Restrict edits to a directory → `/freeze` or `/unfreeze`
- Upgrade gstack → `/gstack-upgrade`
- Save progress → `/context-save`
- Resume, restore → `/context-restore`
- Security audit, OWASP → `/cso`
- Make a PDF → `/make-pdf`
- Launch real browser for QA → `/open-gstack-browser`
- Performance regression → `/benchmark`
- Code quality dashboard → `/health`
