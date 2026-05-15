# Changelog — QAD Platform

## Phase 8 — Documentation & Handoff (2026-05-15)

- Added `README.md` — project overview, quick start, service table, structure map
- Added `docs/architecture.md` — system diagram, component details, data flow, network topology
- Added `docs/operator-guide.md` — dashboard walkthrough, daily checklist, exception handling, client management
- Added `docs/deployment-guide.md` — local and production setup, SSL, GPU, backup/restore, troubleshooting
- Added `CHANGELOG.md`

---

## Phase 7 — Docker Deployment (2026-05-14 → 2026-05-15)

- Extended `docker-compose.yml` to cover all 5 services: postgres, n8n, ollama, dashboard API, React client
- Added `dashboard/api/Dockerfile` — `npm ci --omit=dev`, proper layer caching
- Added `dashboard/client/Dockerfile` — multi-stage build: Vite build → nginx serve
- Added `dashboard/client/nginx.conf` — SPA routing + `/api` proxy to API container
- Added `.env.example` — documented all required environment variables
- Fixed `docker-compose.yml`: postgres joins `docker_qad-network` with alias `postgres` (persists network alias across container recreation)
- Initialized git repository

**Verified:** `docker compose up -d` brings all 5 containers up cleanly. All 3 automation webhooks activate and respond correctly. Dashboard accessible at `http://localhost:80`.

---

## Phase 6 — End-to-End Integration (2026-05-14)

- Verified full loop: `POST webhook` → n8n → automation table + workflow_runs → dashboard API → UI
- Fixed docker network split: `qad_postgres` connected to `docker_qad-network` with alias `postgres`
- Fixed `/reports` page: restarted API server to load updated routes
- Fixed document classification chart: replaced Pie chart with horizontal Bar chart for 9-item legend
- Fixed calendar timezone display: IANA string was appended as raw text; now passed as `timeZone` option
- All 9 dashboard pages verified: 0 console errors, live data throughout

**Health score:** 60 → 95

---

## Phase 5 — React Dashboard Build (2026-05-12 → 2026-05-14)

- Built full React dashboard with 9 sections: Overview, Automations, Activity, Documents, Calendar, Exceptions, Reports, Settings, Tasks
- Stack: React 19 + Vite + Tailwind CSS + Recharts + react-router-dom
- `ClientConfigContext` drives all automation metadata — no hardcoded strings in components
- Express API with 9 route files, connected to PostgreSQL via `pg`
- Feature flag system via `client_config.json`
- Fixed `v_workflow_health` view: added `cold` to the failed bucket (workflow uses `cold` not `disqualified`)

---

## Phase 4 — Dashboard Design (2026-05-12)

- Full design specification in `dashboard/design/phase4_design_doc.md`
- Design system: Poppins + Inter, #6366F1 primary, 12-column grid, 8px base unit
- 9 sections defined with full layout specs, component guidance, and empty/error states
- Feature flag and white-label architecture specified
- Implementation roadmap (5a–5g) defined

---

## Phase 3 — Connectivity & Storage Testing (2026-05-11)

- Wired `workflow_runs` logging into all 3 automations via `patch_wire_workflow_runs.js`
- 31-check integration test suite: all 3 webhooks, all 3 automation tables, all 4 views
- Fixed intake deduplication: `is_duplicate` now set via PostgreSQL EXISTS subquery on `contact_email`
- Full chain verified: webhook → n8n → table → views

---

## Phase 2 — Data Spine (2026-05-11)

- Created `data_spine/data_spine.sql` — idempotent migration
- Tables: `clients`, `workflow_runs`, `audit_log`; extended `workflow_errors`
- Views: `v_recent_activity`, `v_daily_summary`, `v_workflow_health`, `v_client_summary`
- Seed: `data_spine/seed_dev.sql`

---

## Phase 1 — Automation Build (2026-05-08 → 2026-05-11)

### Customer Intake & Qualification v1

- n8n workflow ID: `4aPludoDhXMyAk7x`
- Webhook: `POST /webhook/customer-intake`
- Rule-based lead scoring (0–100 pts) + Ollama second opinion
- Tiers: hot (≥80) → schedule_call, warm (50–79) → send_info_packet, cold (<50) → do_not_pursue
- Fallback: pending_review when Ollama fails or confidence < 0.5
- All 5 fixtures passing

### Document Intake & Processing v1

- n8n workflow ID: `riCozLIp9vwM1mjt`
- Webhook: `POST /webhook/document-intake`
- 10 document classes; hybrid keyword + AI scoring
- Confidence: 0.92 (auto-process), 0.75 (keyword only), 0.65 (disagree → human review), 0.55 (AI only)
- All 5 fixtures passing

### Appointment & Scheduling v1

- n8n workflow ID: `muVXGTx7suWyjaiT`
- Webhook: `POST /webhook/appointment`
- Handles: book, reschedule, cancel, inquiry
- Conflict detection via PostgreSQL OVERLAPS
- Business hours enforcement (soft — routes to pending_review, not reject)
- All 14 fixtures passing

---

## Phase 0 — Scope Freeze (2026-05-07)

- Stack locked: n8n, PostgreSQL, React, Docker
- 3 automations defined: customer intake, document intake, appointment scheduling
- Naming conventions, versioning, and environment separation defined
- Logging schema defined (execution ID, timing, status, token usage, business outcome)
- Code review gate format defined
