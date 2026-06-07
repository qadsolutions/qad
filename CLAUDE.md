# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Objective

Build a private, multi-tenant RAG (Retrieval-Augmented Generation) platform for
small service businesses. Each client gets a secure isolated workspace and AI agent
grounded in their own knowledge. The owner controls everything from a central admin
dashboard. No client data touches public LLM APIs.

See `business_description.md` for the business model and go-to-market context.
See `design.md` for the full product design and discovery session output.

---

## Infrastructure Commands

### Start all services
```bash
docker compose up -d
```

### Stop all services
```bash
docker compose down
```

### View logs
```bash
docker compose logs -f           # all services
docker compose logs -f postgres  # specific service
```

### Connect to PostgreSQL directly
```bash
docker exec -it qad_postgres psql -U qad_user -d qad
```

### Pull and run the local LLM (first time or after volume wipe)
```bash
docker exec qad-ollama ollama pull llama3.2
```

### Check Ollama models available
```bash
docker exec qad-ollama ollama list
```

> **Note:** `docker-compose.yml` currently references `./dashboard/api` and
> `./dashboard/client` which no longer exist. These services (`api`, `client`)
> must be removed or replaced when the new platform is scaffolded. The three
> core services — `postgres`, `n8n`, `ollama` — are valid and ready.

---

## Architecture

### What We Are Building

A private multi-tenant RAG platform. Small service businesses (junk removal, auto
repair, plumbing, HVAC, landscaping) get an AI agent that knows their pricing,
service area, policies, and workflows. The owner manages all clients from one
admin dashboard.

### Core Data Flow

```
Client asks question in portal
  → Backend validates tenant + permissions
  → pgvector retrieves only that tenant's document chunks
  → Backend builds prompt (system instructions + question + retrieved context)
  → Private Ollama inference server generates answer
  → Backend logs request, response, chunks, timestamps
  → Answer returned to client
```

### Tenant Isolation

Every database record carries `tenant_id`. Every vector retrieval query filters by
`tenant_id`. Clients are physically separated via distinct pgvector schemas — one
schema per tenant. This must be enforced at the query layer, not just the app layer.

### Stack

| Layer | Technology | Status |
|---|---|---|
| Private LLM | Ollama (llama3.2) | Running — localhost:11434 |
| Workflow engine | n8n | Running — localhost:5678 |
| Database | PostgreSQL 16 + pgvector | Running — localhost:5433 |
| Vector store | pgvector (in PostgreSQL) | Extension needed on new schema |
| Backend API | Node.js or Python — not built yet | — |
| Frontend | Next.js or React — not built yet | — |
| Auth | Not decided (Clerk, Supabase Auth, or custom) | — |

### Key Architectural Decisions

- **pgvector over a separate vector DB** — keeps the stack simple, reuses existing
  PostgreSQL container. Revisit at 10+ clients if retrieval latency becomes an issue.
- **Ollama as inference server** — already running, OpenAI-compatible API, keeps all
  client data private. No raw prompts or documents go to external APIs.
- **Tenant isolation via schema separation** — each client gets their own pgvector
  schema. This must be decided and implemented before signing client 2.
- **n8n for downstream automations** — not part of the core RAG flow, but available
  for post-answer workflows (CRM updates, notifications, scheduling triggers).

### Database Entities (planned)

`tenants` · `users` · `roles` · `documents` · `document_chunks` · `embeddings` ·
`conversations` · `retrieval_logs` · `model_calls` · `audit_logs` · `settings` ·
`workflows` · `permissions`

### Document Ingestion Pipeline (planned)

1. Accept PDF, DOCX, TXT, markdown, FAQ
2. Parse and chunk by token count with overlap
3. Generate embeddings via Ollama (private, no external API)
4. Store chunk text + metadata + `tenant_id` in pgvector
5. Re-index on document update; track source version and timestamp

### Build Order

1. Auth + tenant model
2. PostgreSQL schema + pgvector per-tenant namespaces
3. Document ingestion + chunking pipeline
4. Vector search with tenant filtering
5. Ollama inference connection + RAG answer endpoint
6. Client portal (secure login, chat interface, document upload)
7. Owner admin dashboard (tenant management, logs, config)
8. Audit trail + monitoring
9. Docker deployment config
10. n8n workflow hooks

---

## Service Endpoints (dev)

| Service | URL | Credentials |
|---|---|---|
| PostgreSQL | localhost:5433 | qad_user / changeme |
| n8n | http://localhost:5678 | admin / Qad_secure_pass1 |
| Ollama | http://localhost:11434 | no auth |

> Production credentials must be set via `.env`. Never commit `.env`.
> `N8N_ENCRYPTION_KEY` must not change after first n8n run — it decrypts stored credentials.

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
