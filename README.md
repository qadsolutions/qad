# QAD Solutions — Private RAG Agent Platform

A private, multi-tenant AI agent platform for small service businesses. Each client gets an AI agent grounded in their own knowledge — pricing, service area, policies, and workflows — without their data ever touching a public AI service.

> **Status:** Pre-build · Customer discovery in progress · Infrastructure scaffolded

---

## What This Builds

Owner-operated service businesses lose leads and waste staff time answering the same questions on repeat. Their knowledge lives in the owner's head or scattered across text messages — generic AI tools don't know any of it.

This platform gives each client a private RAG agent (Retrieval-Augmented Generation) built from their own documents: price lists, service area rules, FAQs, SOPs, and anything else they know that a customer or employee might ask.

**Who manages it:** You (the platform owner) — one admin dashboard, all clients.  
**Who uses it:** Client staff and customers — a secure portal per tenant.  
**Where data goes:** Nowhere public. Every inference call hits a private Ollama server.

---

## Target Industries

| Industry | Primary pain |
|---|---|
| Junk removal | Pricing by volume/item, service area, what they take |
| Auto repair | Labor/parts pricing, scheduling, status updates |
| Plumbing | Emergency vs. scheduled, pricing, service area |
| HVAC | Seasonal demand, emergency dispatch, pricing |
| Pest control | Service area, pricing by pest type, retreat policies |
| Landscaping | Service types, availability, seasonal schedules |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14+ (TypeScript, React, Tailwind CSS) |
| Backend | Next.js API Routes on Vercel Serverless |
| Database | Supabase (PostgreSQL 16 + pgvector + Auth + Storage) |
| Auth | Supabase Auth — JWT with `tenant_id` + role claims |
| Vector store | pgvector (HNSW index, 768-dim) |
| Embeddings | Ollama `nomic-embed-text` — runs locally |
| Inference (prototype) | Groq API — **synthetic data only** |
| Inference (production) | Ollama + vLLM on private GPU server |
| Deployment | Vercel Pro |
| Containers | Docker (local dev: Ollama + n8n) |

---

## Milestone Progress

| # | Milestone | Status |
|---|---|---|
| M1 | Auth + Tenant Model | 🔲 Pending |
| M2 | PostgreSQL Schema + pgvector | 🔲 Pending |
| M3 | Document Ingestion Pipeline | 🔲 Pending |
| M4 | Vector Search + RAG Endpoint | 🔲 Pending |
| M5 | Ollama Inference + Streaming | 🔲 Pending |
| M6 | Client Portal | 🔲 Pending |
| M7 | Owner Admin Dashboard | 🔲 Pending |
| M8 | E2E Testing + Playwright | 🔲 Pending |
| M9 | Audit Trail + Monitoring | 🔲 Pending |
| M10 | Production Deploy + Hardening | 🔲 Pending |

Status key: 🔲 Pending · 🟡 In Progress · ✅ Complete · ❌ Blocked

Full milestone detail, exit criteria, and task checklists: [`ROADMAP.md`](ROADMAP.md)

---

## Local Development

### Prerequisites

- Docker Desktop
- Node.js 20+

### Start local services

```bash
docker compose up -d
```

| Service | URL |
|---|---|
| Ollama | http://localhost:11434 |
| n8n (deferred — M7+) | http://localhost:5678 |

### Pull models (first run)

```bash
docker exec qad-ollama ollama pull nomic-embed-text
docker exec qad-ollama ollama pull llama3.2
```

### Environment setup

```bash
cp .env.example .env.local
# Fill in values — see .env.example for required keys
```

### App (once Next.js is scaffolded — M1)

```bash
npm install
npm run dev
```

---

## Security Model

Three non-negotiable constraints:

1. **`SUPABASE_SERVICE_ROLE_KEY` is never prefixed `NEXT_PUBLIC_`.** It bypasses all RLS — exposing it collapses tenant isolation.
2. **Groq API is for synthetic data only.** Real client documents must never be sent to an external API. Switch to `INFERENCE_PROVIDER=ollama` before loading any real data.
3. **Tenant isolation is enforced at two layers** — RLS on every table (`auth.jwt()->>'tenant_id'`) and tenant middleware on every API route. The cross-tenant isolation test is an M1 exit criterion.

Full security policies: [`SECURITY.md`](SECURITY.md)

---

## Project Docs

| File | Purpose |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Full architecture spec, stack decisions, build order, security rules |
| [`ROADMAP.md`](ROADMAP.md) | Milestone timeline, exit criteria, task checklists |
| [`business_description.md`](business_description.md) | Business model, target customers, go-to-market |
| [`design.md`](design.md) | Product design and discovery session output |
| [`SECURITY.md`](SECURITY.md) | Security policies and threat model |
| [`GIT_PROCEDURES.md`](GIT_PROCEDURES.md) | Branch strategy, PR process, commit conventions |
| [`TODOS.md`](TODOS.md) | Active work items |

---

## Business Model

| Component | Range |
|---|---|
| Setup / implementation fee | $2,500 – $10,000 |
| Monthly management fee | $300 – $2,000/month |
| Add-ons (voice, CRM, workflows) | Quoted separately |

Monthly fee covers hosting, knowledge base maintenance, prompt tuning, and updates. The agent is built from the client's own knowledge layer — switching cost is high by design.
