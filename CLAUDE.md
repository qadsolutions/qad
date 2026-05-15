# CLAUDE.md — Production Agent Project

## Project Purpose
Build three deployable business automations backed by a shared PostgreSQL data spine, a React operator dashboard, and a Docker deployment path. Revenue-generating automations ship first; platform infrastructure follows.

## Stack
- **Workflows:** n8n
- **Database:** PostgreSQL
- **Frontend:** React
- **Deployment:** Docker

---

## Phase Gate Rule
**At the end of every phase, ask the user:**
> "Phase [X] is complete. Can we move on to [Phase X+1: Name]?"

Do not advance to the next phase until the user explicitly approves. During any phase, stay focused only on that phase's deliverables. Do not build ahead.

---

## Phase Overview

| Phase | Name | Goal |
|---|---|---|
| 0 | Scope Freeze | Lock product scope, stack, conventions, and logging schema |
| 1 | Automation Build | Build the 3 automations as deployable templates |
| 2 | Data Spine | PostgreSQL schema, shared logging, audit visibility |
| 3 | Connectivity & Storage Testing | Prove the system survives real usage |
| 4 | Dashboard Design | UX map, components, data mapping — no code yet |
| 5 | React Dashboard Build | Implement the client and operator dashboard |
| 6 | End-to-End Integration | Verify full loop: automation → storage → dashboard |
| 7 | Docker Deployment | Containerize the full stack |
| 8 | Documentation & Handoff | README, guides, architecture, change log |

---

## Current Phase
**Phase 5 — React Dashboard Build** *(Complete — Phase 5 review pending)*

---

## Phase 0: Scope Freeze
**Goal:** Lock product scope and standards before building.

Deliverables:
- Confirm the 3 out-of-box automations
- Confirm Postgres, n8n, and React as the stack
- Define naming conventions, versioning, and environment separation
- Define the logging schema and review gate format
- Create the first CLAUDE.md update standard

Exit criteria:
- Scope approved
- No open architecture disputes
- Phase review completed

---

## Agent Behavior Rules
- Do not build everything at once.
- Do not add features outside the current phase.
- Keep logs and docs updated continuously.
- Prefer reusable components and shared services.
- Treat workflow templates as production assets.
- Preserve traceability from UI to workflow to database.
- Always close each phase with a formal review.

---

## Code Review Gate
No phase advances without a review covering:
- Functional correctness
- Logging completeness
- Security
- Test coverage
- Documentation
- Deployment readiness

---

## CLAUDE.md Update Rule
At the end of every phase, update this file with:
- Phase name
- Decisions made
- Files changed
- Tests run
- Open issues
- Risks
- Next phase instructions
- Review outcome

---

## Logging Schema (required on every workflow run)
- Execution ID
- Workflow ID
- Client ID
- Start and end timestamps
- Duration
- Success or failure
- Error message
- Token usage
- API calls
- Business outcome metric

---

---

## n8n Skills Reference

Source: https://github.com/czlonkowski/n8n-skills — 7 skills for building production-ready n8n workflows.

---

### Skill 1 — n8n Expression Syntax

- All dynamic values use double curly braces: `{{expression}}`
- Core variables: `$json` (current node output), `$node["Node Name"].json` (other nodes), `$now` (timestamps via Luxon)
- **Webhook data is nested under `.body`** — use `{{$json.body.fieldName}}`, not `{{$json.fieldName}}`
- Quote node names with spaces: `{{$node["HTTP Request"].json}}`
- Use bracket notation for special characters: `{{$json['field name']}}`
- Node names are case-sensitive
- Never use expressions inside: Code nodes (use JS directly), webhook paths, or credential fields
- Never nest braces

---

### Skill 2 — n8n MCP Tools Expert (highest priority)

- 9 tool categories: node discovery, config validation, workflow management, templates, workflow generation, data tables, credential management, security auditing, documentation
- **nodeType format matters:**
  - Search/Validate tools → `nodes-base.slack`
  - Workflow tools → `n8n-nodes-base.slack`
  - Mixing these causes "Node not found" errors
- Build order: search nodes → get details → validate config → create workflow → iterate updates → validate again → activate
- Use `detail: "standard"` for 95% of cases — reserve `detail: "full"` for debugging only
- Build workflows iteratively (~56 seconds between edits), not in one shot
- Most tools respond in milliseconds; security audits take 500–5000ms

---

### Skill 3 — n8n Workflow Patterns

Six primary patterns:
1. **Webhook Processing** (35% of workflows) — most common entry point
2. **HTTP API Integration** — calling external services
3. **Database Operations** — reading/writing data
4. **AI Agent Workflow** — LLM-driven decisions
5. **Scheduled Tasks** — cron-triggered automation
6. **Batch Processing** — SplitInBatches for large datasets

Data flow types: linear, branching, parallel, loop, error handling.

Key gotchas:
- Webhook data structures require `.body` access
- Multiple items need iteration awareness
- Always plan → implement → validate → deploy (never one-shot)
- Validate before every deployment

---

### Skill 4 — n8n Validation Expert

- Validation profiles: `minimal`, `runtime`, `ai-friendly`, `strict`
- Typical fix cycle: 2–3 validation rounds
- Distinguish errors (block execution) from warnings (optional) from false positives
- Auto-sanitization fixes operator structure issues automatically
- Common issues: missing required fields, type mismatches, invalid expressions, broken node references

---

### Skill 5 — n8n Node Configuration

- Start with `get_node({detail: "standard"})` — covers 95% of needs, 1–2K tokens
- Fields are operation-aware: not all fields apply to every operation (e.g. Slack `post` needs `channel`, `update` needs `messageId`)
- Fields appear/disappear via `displayOptions` based on other values
- Configuration cycle: set required fields → validate → adjust → validate → deploy
- Use `patchNodeField` for surgical edits to large fields (code blocks, templates)
- Escalate to `detail: "full"` only when standard detail proves insufficient

---

### Skill 6 — n8n Code Node (JavaScript)

- Use **"Run Once for All Items"** for 95% of cases
- Always return an array with `json` key:
  ```javascript
  return [{ json: { field: value } }];
  ```
- Data access: `$input.all()` for arrays, `$input.first()` for single objects, `$input.item` in Each Item mode
- Webhook data is nested under `.body`
- Built-ins: `$helpers.httpRequest()`, `DateTime` (Luxon), `$jmespath()`
- SplitInBatches: `main[1]` processes each batch (counterintuitive naming)
- Cross-iteration data: use workflow static data to accumulate — `.all()` returns only last iteration after loops
- New output items need `pairedItem` metadata
- Round floats for currency comparisons

---

### Skill 7 — n8n Code Node (Python)

- Use JavaScript instead for 95% of cases — Python only when you need standard library specifics
- No external libraries — only: `json`, `datetime`, `re`, `base64`, `hashlib`, `urllib.parse`, `math`, `random`, `statistics`
- Return format: `[{"json": {...}}]` — a list of dicts with a `"json"` key
- Data access: `_input.all()`, `_input.first()`, `_input.item`
- Webhook data nested under `["body"]`
- Never use `import requests`, `import pandas`, etc.

---

## Phase History

### Phase 1 — Automation Build
- Status: Complete — pending formal code review gate
- Started: 2026-05-08
- Completed: 2026-05-11

**Automation 1: Customer Intake & Qualification v1**
- Status: Built and deployed to n8n
- n8n Workflow ID: `4aPludoDhXMyAk7x`
- Webhook: `POST http://localhost:5678/webhook/customer-intake`
- Files:
  - `automations/customer_intake_v1/workflow.json` — full n8n workflow
  - `automations/customer_intake_v1/workflow_upload.json` — upload copy (no tags)
  - `automations/customer_intake_v1/postgres_schema.sql` — run before activation
  - `automations/customer_intake_v1/README.md` — operator + technical docs
  - `automations/customer_intake_v1/schema.md` — input/output schema
  - `automations/customer_intake_v1/error_handling.md` — retry and error rules
  - `automations/customer_intake_v1/test_fixtures.json` — 5 test cases
  - `automations/customer_intake_v1/summary.md` — client-facing summary

**Architecture decisions:**
- Ollama (llama3.2) used for local AI classification — no external APIs
- Rules-first scoring with AI confidence overlay (not AI-first)
- `continueOnFail: true` on all external nodes (email, postgres) — never silent failures
- `ON CONFLICT (intake_id) DO NOTHING` for duplicate-safe logging
- Industry fit is configurable via arrays in the scoring code node
- Fallback path routes to `pending_review` whenever Ollama fails or confidence < 0.5

**Credentials needed before activation:**
- `postgres_main` — PostgreSQL connection
- SMTP credential — for email notification nodes

**Test results (all passed):**
- Test 1: Hot lead → score 92, tier hot, email alert sent ✅
- Test 2: Warm lead → tier warm, info packet sent ✅
- Test 3: Disqualified → tier disqualified, no outreach ✅
- Test 4: Validation error → 400 response, logged ✅
- Test 5: AI failure sim → tier hot (Ollama available), fallback path confirmed via earlier timeout tests ✅

**Open issues:**
- Email node credentials not yet configured (Gmail OAuth2 is configured — SMTP not needed)
- Ollama must be running locally on port 11434 before activation

---

**Automation 3: Appointment & Scheduling Automation v1**
- Status: Built, deployed, tested — all 14 tests passing
- n8n Workflow ID: `muVXGTx7suWyjaiT`
- Webhook: `POST http://localhost:5678/webhook/appointment`
- Files:
  - `automations/appointment_scheduling_v1/workflow.json` — full n8n workflow (34 nodes)
  - `automations/appointment_scheduling_v1/workflow_upload.json` — upload copy
  - `automations/appointment_scheduling_v1/postgres_schema.sql` — appointment_log table (applied)
  - `automations/appointment_scheduling_v1/schema.md` — input/output schema
  - `automations/appointment_scheduling_v1/README.md` — operator + technical docs
  - `automations/appointment_scheduling_v1/error_handling.md` — error rules
  - `automations/appointment_scheduling_v1/test_fixtures.json` — 14 test cases
  - `C:\qad\test_appointment_scheduling.ps1` — test runner

**Architecture decisions:**
- **Keyword + Ollama intent classification**: explicit request_type wins (1.0), keyword rules (0.80–0.90), Ollama second opinion when < 0.85, fallback to 'book'/'inquiry'
- **Business hours as soft flags**: outside hours routes to pending_review, not rejected — preserves all requests
- **Auto-confirm logic**: trusted sources (internal/crm/staff) auto-confirm; urgent always requires staff review; outside-hours always requires staff review
- **Conflict detection via PostgreSQL OVERLAPS**: no external calendar API needed
- **Reminder sequence as JSONB**: stored for companion cron workflow processing
- **continueOnFail: true** on all Ollama, Postgres, Gmail nodes
- **ON CONFLICT DO UPDATE** — idempotent logging
- All 5 routing paths (book/reschedule/cancel/inquiry/fallback) converge at Prepare Log Data

**Test results (all 14 passed 2026-05-11):**
- TC-APT-01: Valid booking → confirmed ✅
- TC-APT-02: Internal source → auto-confirmed ✅
- TC-APT-03: Overlapping slot → conflict detected ✅
- TC-APT-04: Outside hours → pending_review (not rejected) ✅
- TC-APT-05: Missing email → 400 validation error ✅
- TC-APT-06: Missing time → 400 validation error ✅
- TC-APT-07: Reschedule → rescheduled ✅
- TC-APT-08: Cancel → cancelled ✅
- TC-APT-09: Inquiry (natural language) → pending_review ✅
- TC-APT-10: Urgent booking → pending_review (staff review required) ✅
- TC-APT-11: Empty body → graceful handling, no crash ✅
- TC-APT-12: Ollama fallback → confirmed (keyword routing) ✅
- TC-APT-13: Saturday within hours → confirmed ✅
- TC-APT-14: Sunday closed → pending_review ✅

**Credentials needed:**
- PostgreSQL: `MMScP2tKEgzvhkYM` — already configured
- Gmail OAuth2: `bHMHyGqUtDInnHet` — already configured
- Ollama must be running at localhost:11434

---

**Automation 2: Document Intake & Processing Agent v1**
- Status: Built, deployed, tested — all 5 tests passing
- n8n Workflow ID: `riCozLIp9vwM1mjt`
- Webhook: `POST http://localhost:5678/webhook/document-intake`
- Files:
  - `automations/document_intake_v1/workflow.json` — full n8n workflow (19 nodes)
  - `automations/document_intake_v1/workflow_upload.json` — upload copy (no tags)
  - `automations/document_intake_v1/postgres_schema.sql` — creates document_log table (already applied)
  - `automations/document_intake_v1/schema.md` — input/output schema + extracted field definitions
  - `automations/document_intake_v1/postgres_schema.sql` — run before activation
  - `automations/document_intake_v1/test_fixtures.json` — 5 test cases
  - `C:\qad\test_doc_intake.ps1` — test runner

**Architecture decisions:**
- **Hybrid classification**: keyword rules (deterministic) + Ollama (second opinion) — consensus scoring
  - Agreement (keyword + AI match): 0.92 confidence → auto_process if ≥ 0.80
  - Keyword only (AI unavailable): 0.75 → human_review
  - Keyword + AI disagree: 0.65 → human_review + flag
  - AI only (no keyword match): 0.55 → human_review
- **Code-based field extraction**: regex patterns per document type — not delegated to AI
- **Confidence threshold enforcement in code** — AI cannot override routing logic
- **Document-type-specific routing destinations**: accounts_payable, legal_review, patient_intake, etc.
- **Auto-escalation**: court_document always escalated regardless of confidence
- **10 document classes**: invoice, contract, referral, receipt, intake_form, court_document, id_document, tax_document, real_estate, correspondence (+ unknown)
- `continueOnFail: true` on Ollama and PostgreSQL nodes
- `ON CONFLICT (document_id) DO NOTHING` for duplicate-safe logging
- Validation failures return HTTP 400 and are logged separately

**Test results (all passed 2026-05-09):**
- Test 1: Invoice → accounts_payable, 0.92 confidence, invoice_number/vendor/total/terms extracted ✅
- Test 2: Medical referral → patient_intake, patient_name/DOB/physician/NPI extracted ✅
- Test 3: Contract/NDA → legal_review, contract_type/effective_date/governing_law/term extracted ✅
- Test 4: Validation failure (missing file_name) → 400 rejected ✅
- Test 5: Ambiguous correspondence → general_inbox, routes to human_review ✅

**Credentials needed:**
- PostgreSQL: `MMScP2tKEgzvhkYM` — already configured
- Gmail OAuth2: `bHMHyGqUtDInnHet` — already configured
- Ollama must be running at localhost:11434

---

### Phase 0 — Scope Freeze
- Status: Complete
- Started: 2026-05-07
- Completed: 2026-05-07

**Decisions made:**
- Automations locked: customer intake & qualification, invoice & billing, appointment & scheduling
- Stack locked: n8n, PostgreSQL, React, Docker
- Naming: `snake_case` for files/DB, `PascalCase` for React components, `SCREAMING_SNAKE_CASE` for env vars
- Versioning: `_v{n}` suffix for workflows, semantic versioning for project releases
- Environments: `development`, `staging`, `production` with separate `.env` files; no prod credentials in version control
- Logging schema defined (see Logging Schema section above)
- Code review gate defined (see Code Review Gate section above)
- CLAUDE.md update standard defined

**Open issues:** None
**Risks:** None identified at this stage
**Review outcome:** Approved by user 2026-05-07

**Next phase:** Phase 1 — Automation Build

---

### Phase 2 — Data Spine
- Status: Complete
- Started: 2026-05-11
- Completed: 2026-05-11

**Deliverables:**
- `data_spine/data_spine.sql` — idempotent migration (tables + views)
- `data_spine/seed_dev.sql` — development client seed
- `data_spine/README.md` — operator guide

**Tables created:**
- `clients` — soft client registry; `client_id` TEXT PK, no FK constraints on automation tables
- `workflow_runs` — canonical execution log matching Phase 0 logging schema
- `audit_log` — immutable status-change record across all automations
- `workflow_errors` — extended with `client_id`, `node_name`, `workflow_name` columns

**Views created:**
- `v_recent_activity` — unified feed (UNION of all 3 automation tables, last 200 rows)
- `v_daily_summary` — day × automation × status counts (last 90 days)
- `v_workflow_health` — success/failure/in-review rates per automation (last 30 days)
- `v_client_summary` — per-client totals across all automations

**Architecture decisions:**
- **Soft reference for client_id** — no FK constraints; automations log unknown client IDs without errors; dashboard enforces registration
- **No triggers on audit_log** — workflows write explicitly for traceability
- **Status normalization in views** — each automation uses different vocabulary; v_workflow_health maps them to common buckets (successful/failed/in_review)
- **Shape 2 deployment** — single Docker stack per client; `client_id` handles multi-department, not cross-client multi-tenancy

**Open issues:**
- `workflow_runs` writes not yet wired into automation workflows (Phase 3)
- `audit_log` writes not yet wired (Phase 3)

**Review outcome:** Approved by user 2026-05-11

**Next phase:** Phase 3 - Connectivity & Storage Testing

---

### Phase 3 - Connectivity & Storage Testing
- Status: Complete
- Started: 2026-05-11
- Completed: 2026-05-11

**Deliverables:**
- `patch_wire_workflow_runs.js` - wired workflow_runs logging into all 3 automations
- `test_phase3_connectivity.ps1` - 30-check integration test suite

**What was tested (30/30 passing):**
- All 3 webhooks reachable and return valid responses
- All 3 automation-specific tables persist rows correctly
- workflow_runs table populated by all 3 automations (execution_id, run_status, business_outcome)
- All 4 views return correct data (v_recent_activity, v_daily_summary, v_workflow_health, v_client_summary)
- v_recent_activity covers all 3 automations in a single feed
- v_client_summary joins correctly for registered clients
- Duplicate submissions do not crash; validation failures return 400 gracefully
- Empty payloads handled without crash

**Known data quality gaps:**
- intake_log deduplication operates on intake_id (unique per run) not contact_email - two submissions from the same email both persist. The is_duplicate flag is not set by email match. Logged for dashboard attention in Phase 5.
- workflow_runs does not capture token_usage or api_calls detail yet - JSONB fields left as defaults. Could be enriched in a future patch.

**Architecture confirmed:**
- Full chain verified: webhook POST -> n8n -> automation-specific table -> workflow_runs -> views
- All views derive from real data, no static fixtures
- ON CONFLICT idempotency works correctly for appointment_log and document_log

**Phase 3 post-completion fix:**
- `patch_fix_intake_dedup.js` applied — replaced `{{ $json.is_duplicate }}` in intake workflow's Log to PostgreSQL node with a PostgreSQL EXISTS subquery. The subquery checks for a prior row with the same contact_email at INSERT time. Verified: second submission from same email now logs `is_duplicate=true`.
- `test_phase3_connectivity.ps1` updated to 31 checks — added "Second intake row has is_duplicate=true" assertion. All 31 passing.

**Review outcome:** Approved by user 2026-05-11

**Next phase:** Phase 4 - Dashboard Design

---

### Phase 4 - Dashboard Design
- Status: Complete
- Started: 2026-05-12
- Completed: 2026-05-12

**Deliverables:**
- `dashboard/design/phase4_design_doc.md` - Full design specification

**Design system (from ui-ux-pro-max skill):**
- Style: Data-Dense Minimalism + Soft UI Evolution
- Primary font: Poppins (headings/display) + Inter (body/data)
- Primary color: #6366F1 (indigo-500), single accent strategy
- Status palette: emerald / amber / rose / sky — semantic only, never decorative
- Component shadow: 4-level elevation system
- Grid: 12-column, 8px base unit, 24px card padding
- Charts: Recharts (line, area, bar, donut) for trend and comparison data

**Design decisions:**
- 9 primary sections with full URL structure defined
- Fixed sidebar (240px dark) + sticky top bar (64px white)
- Sidebar collapses to 64px icon-only on tablet
- Detail drawers (480px) slide in from right — no full-page detail views
- CSS custom property theming for white-label support (`--color-primary`)
- Feature flag system via `client_config.json` — disable sections per client
- Shape 2 deployment alignment — per-client dashboard stack, `client_id` handles multi-department
- Client logo injection in sidebar top (max 160x40px)
- All status vocabulary normalized in views — dashboard consumes v_recent_activity directly

**Information architecture:**
- /dashboard (Overview), /automations, /activity, /documents, /tasks, /calendar, /exceptions, /reports, /settings
- All 9 sections have screen-by-screen layout specs, component guidance, and empty/loading/error state definitions

**Implementation roadmap:**
- Phase 5a: Shell, layout, routing, design tokens
- Phase 5b: Overview + Automations (KPI strip, health cards, sparklines)
- Phase 5c: Activity + Exceptions (timeline, filters, drawers)
- Phase 5d: Documents + Tasks + Calendar
- Phase 5e: Reports (charts, date range, PDF export)
- Phase 5f: Polish — skeletons, microinteractions, responsive, a11y
- Phase 5g: Theming, client config, feature flags

**Open issues:** None
**Risks:** None identified — design phase is documentation only, no code
**Review outcome:** Approved by user 2026-05-12

**Next phase:** Phase 5 - React Dashboard Build

**Phase 5 architectural constraints (non-negotiable):**
- No hardcoded automation lists anywhere in React — always map over `config.automations`
- `ClientConfigContext` is the single source of truth for automation metadata (label, icon, db_table, workflow_id, report_metrics)
- Feature sections not in `features_enabled` are removed from the router and sidebar entirely — not empty, not 403, simply absent
- API queries use `automation.workflow_id` and `automation.db_table` from config, never hardcoded strings
- Report sections generated from `automation.report_metrics[]`, not hardcoded per-automation blocks
- Pass/fail test: adding a new automation must require only a `client_config.json` update and a DB table — zero React component changes

---

## Credentials & Connection Reference

### PostgreSQL (qad_postgres Docker container)
- **Host (dev):** `localhost:5433` — port remapped to avoid conflict with local Windows Postgres on 5432
- **Database:** `qad`
- **User:** `qad_user`
- **Password:** `changeme` — this is the actual password in the Docker volume (set at first container creation; docker-compose default was used before .env was in place)
- **Connect inside container:** `docker exec qad_postgres psql -U qad_user -d qad`

### n8n
- **URL:** `http://localhost:5678`
- **Admin password:** `Qad_secure_pass1`
- **API Key:** see `.env` → `N8N_API_KEY`
- **Credentials configured in n8n:**
  - PostgreSQL: `MMScP2tKEgzvhkYM`
  - Gmail OAuth2: `bHMHyGqUtDInnHet`

### Dashboard API (dev server)
- **Port:** `3001`
- **Start command:** `cd dashboard/api && node index.js`
- **Requires env vars:** `PGHOST=localhost PGPORT=5433 PGUSER=qad_user PGPASSWORD=changeme PGDATABASE=qad`
- **db.js defaults** already set to the above — no env vars needed if running from `dashboard/api/`

### Dashboard Client (dev server)
- **Port:** `5173` (Vite)
- **Start command:** `cd dashboard/client && npm run dev`
- **API proxy:** `/api` → `http://localhost:3001`

### Docker Services
| Container | Purpose | Port |
|---|---|---|
| `qad_postgres` | PostgreSQL database | 5433 (host) → 5432 (container) |
| `qad-n8n` | n8n workflow engine | 5678 |
| `qad-api` | Separate API container (not dashboard API) | 3000 |
| `qad-ollama` | Local LLM (llama3.2) | 11434 |
| `qad-pgadmin` | pgAdmin UI | currently restarting |

### Known Infrastructure Notes
- Local Windows Postgres runs on port 5432 and conflicts with Docker's port mapping — `docker-compose.yml` maps `qad_postgres` to **5433** to avoid this
- Ollama must be running at `localhost:11434` before activating n8n automations
- Gmail OAuth2 is configured in n8n — SMTP credentials are not needed

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. The
skill has multi-step workflows, checklists, and quality gates that produce better
results than an ad-hoc answer. When in doubt, invoke the skill. A false positive is
cheaper than a false negative.

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
