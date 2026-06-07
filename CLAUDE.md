# CLAUDE.md — Private Multi-Tenant RAG Platform for Small Businesses

---

## Project Objective

Build a private, multi-tenant RAG (Retrieval-Augmented Generation) platform that
lets small service businesses run their own domain-aware AI agents. Each client
gets a secure, isolated workspace. The owner controls everything from a central
admin dashboard. No client data touches public LLM APIs.

This is both a technical product and a business. The goal is a working prototype
that can be demoed to real clients (junk removal, auto repair, plumbing, HVAC,
pest control, landscaping) and converted into paying monthly subscriptions.

See `business_description.md` for the business model and go-to-market context.
See `design.md` for the full product design and discovery session output.

---

## What We Are Building

You are a senior full-stack AI systems architect.

Build a multi-tenant private RAG platform for small businesses. The product should
let the owner orchestrate everything centrally while each client has their own
secure login, isolated workspace, and separated data. The goal is to prototype a
business-aware AI system that can answer questions from a company's own documents,
FAQs, SOPs, pricing sheets, and knowledge base without leaking data between clients.

### CORE GOAL
- Create a private, multi-tenant AI knowledge platform for small businesses.
- Each client gets their own tenant, login, document space, and vector namespace.
- The owner gets an admin dashboard to manage all tenants, monitor usage, review
  logs, update configs, and control deployments.
- The system should be designed for future migration to cloud, but can start
  self-hosted or on a private server for prototyping.
- Avoid sending client data to public LLM APIs. Use a private inference server
  or local model endpoint.

### HIGH-LEVEL ARCHITECTURE
- Frontend: web app for client portal and owner admin.
- Backend API: handles auth, tenant separation, document ingestion, retrieval,
  generation, logging, and admin actions.
- Auth: secure login with tenant-based access control.
- Database: PostgreSQL for users, tenants, documents, logs, permissions, settings.
- Vector store: pgvector or a private vector database with strict tenant filtering.
- Model layer: private inference server running a local or self-hosted LLM.
- Inference access: app backend calls the model server privately; no raw client
  data goes to a public model API.
- Optional workflow layer: n8n for downstream automations later.
- Optional deployment: Vercel for frontend only, not for hosting the model.

### RAG FLOW
1. User asks a question in their client portal.
2. Backend validates tenant and user permissions.
3. Backend retrieves only that tenant's relevant document chunks from vector store.
4. Backend constructs a prompt with system instructions, user question, and context.
5. Backend sends the prompt to the private inference server.
6. Model returns answer.
7. Backend stores request, response, retrieved chunks, timestamps, and audit logs.
8. Backend returns answer to the user.

### TENANT ISOLATION REQUIREMENTS
- Every record must include tenant_id.
- Every retrieval query must filter by tenant_id.
- Each client must only see their own data, documents, chats, and logs.
- Use separate namespaces per tenant or physically separate indexes/collections.
- Add metadata filters and permission checks on every query.
- Maintain audit logs for all retrievals and model calls.

### PRIVATE INFERENCE SERVER REQUIREMENTS
- The model server should be isolated from public internet exposure.
- It should expose an authenticated API endpoint only to the backend.
- Can run locally, on a dedicated server, or on a private cloud GPU instance.
- Support OpenAI-compatible API if possible for easier model swapping.
- Good candidates: Ollama, vLLM, llama.cpp, LM Studio, or similar.
- Keep prompts, retrieved context, and outputs inside the controlled environment.

### RECOMMENDED MVP STACK
- Frontend: Next.js or similar
- Backend: Node.js or Python API service
- Auth: Clerk, Supabase Auth, or custom tenant auth if self-hosted
- Database: PostgreSQL
- Vector storage: pgvector
- Inference server: private self-hosted model runtime (Ollama already running)
- Deployment (app layer): Vercel or similar
- Deployment (model layer): private server or cloud GPU
- File storage: private object storage or local disk for uploaded docs
- Logging/monitoring: structured logs, audit trail, and admin dashboard

### OWNER/ADMIN CAPABILITIES
- Create, edit, delete tenants
- Assign client users
- Upload or approve knowledge sources
- Configure prompts, response tone, and business rules
- View logs, retrieval history, and low-confidence answers
- Manage model endpoint and system settings
- Review failures, outages, or data issues
- Control updates and versioning

### CLIENT PORTAL CAPABILITIES
- Secure login
- View and query company knowledge
- Upload documents if allowed
- See responses, logs, and permitted content
- No access to other tenants
- Optional feedback buttons for answer quality

### DATABASE ENTITIES
- tenants
- users
- roles
- documents
- document_chunks
- embeddings
- conversations
- retrieval_logs
- model_calls
- audit_logs
- settings
- workflows
- permissions

### DOCUMENT INGESTION
- Support PDF, DOCX, TXT, markdown, and FAQ content
- Parse and chunk documents
- Generate embeddings locally or through a private embedding service
- Store chunk text + metadata + tenant_id
- Re-index when documents change
- Track source document version and timestamp

### SECURITY REQUIREMENTS
- Do not leak one tenant's context into another tenant's retrieval
- Do not expose raw documents to public model APIs
- Protect secrets with environment variables
- Use RBAC or tenant-scoped authorization
- Log access to documents and model calls
- Add rate limiting and abuse protection
- Support deletion and retention policies
- Support backups and recovery

### DEPLOYMENT MODEL
- Prototype can start self-hosted on one private server
- App frontend can later move to Vercel
- Model inference should remain in a private environment
- Architecture should be containerized with Docker
- Keep configs portable for future cloud migration
- Do not hardcode tenant-specific logic into the core

### BUILD ORDER
1. Set up auth and tenant model
2. Build PostgreSQL schema
3. Build document ingestion and chunking
4. Build vector search with tenant filtering
5. Build private inference server connection
6. Build RAG answer endpoint
7. Build client portal
8. Build owner admin dashboard
9. Add logs, audit trail, and monitoring
10. Add config-based multi-client management
11. Add deployment scripts and environment config
12. Add workflow hooks for future automations

### OUTPUTS NEEDED
- Architecture diagram in text form
- Folder structure
- Database schema
- API route list
- Ingestion pipeline steps
- Retrieval pipeline steps
- Security design
- Deployment instructions
- MVP roadmap

### CONSTRAINTS
- Start from scratch
- Keep it private and multi-tenant
- Keep the owner in control
- No public LLM API for raw client knowledge
- Build for small business use case, not enterprise-only
- Simple enough to prototype, structured enough to scale later

---

## Infrastructure Available

### PostgreSQL (existing Docker container)
- Host: `localhost:5433`
- Database: `qad`
- User: `qad_user`
- Password: `changeme`
- Connect: `docker exec qad_postgres psql -U qad_user -d qad`

### n8n (existing)
- URL: `http://localhost:5678`
- Admin password: `Qad_secure_pass1`

### Ollama (existing — private inference server)
- URL: `http://localhost:11434`
- Model: llama3.2
- This IS the private inference server referenced in the architecture above

### Docker Services
| Container | Purpose | Port |
|---|---|---|
| `qad_postgres` | PostgreSQL + pgvector | 5433 → 5432 |
| `qad-n8n` | n8n workflow engine | 5678 |
| `qad-ollama` | Local LLM (llama3.2) | 11434 |

---

## Skill Routing

When the user's request matches an available skill, invoke it via the Skill tool.
The skill has multi-step workflows, checklists, and quality gates that produce
better results than an ad-hoc answer. When in doubt, invoke the skill. A false
positive is cheaper than a false negative.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke /office-hours
- Strategy, scope, "think bigger", "what should we build" → invoke /plan-ceo-review
- Architecture, "does this design make sense" → invoke /plan-eng-review
- Design system, brand, "how should this look" → invoke /design-consultation
- Design review of a plan → invoke /plan-design-review
- Developer experience of a plan → invoke /plan-devex-review
- "Review everything", full review pipeline → invoke /autoplan
- Bugs, errors, "why is this broken", "wtf", "this doesn't work" → invoke /investigate
- Test the site, find bugs, "does this work" → invoke /qa (or /qa-only for report only)
- Code review, check the diff, "look at my changes" → invoke /review
- Visual polish, design audit, "this looks off" → invoke /design-review
- Developer experience audit, try onboarding → invoke /devex-review
- Ship, deploy, create a PR, "send it" → invoke /ship
- Merge + deploy + verify → invoke /land-and-deploy
- Configure deployment → invoke /setup-deploy
- Post-deploy monitoring → invoke /canary
- Update docs after shipping → invoke /document-release
- Weekly retro, "how'd we do" → invoke /retro
- Second opinion, codex review → invoke /codex
- Safety mode, careful mode, lock it down → invoke /careful or /guard
- Restrict edits to a directory → invoke /freeze or /unfreeze
- Upgrade gstack → invoke /gstack-upgrade
- Save progress, "save my work" → invoke /context-save
- Resume, restore, "where was I" → invoke /context-restore
- Security audit, OWASP, "is this secure" → invoke /cso
- Make a PDF, document, publication → invoke /make-pdf
- Launch real browser for QA → invoke /open-gstack-browser
- Import cookies for authenticated testing → invoke /setup-browser-cookies
- Performance regression, page speed, benchmarks → invoke /benchmark
- Review what gstack has learned → invoke /learn
- Tune question sensitivity → invoke /plan-tune
- Code quality dashboard → invoke /health
