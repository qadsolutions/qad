# Architecture — QAD Platform

## Overview

QAD is a single-stack business automation platform. Three n8n workflows ingest data from external sources, classify and route it using a rules + AI hybrid approach, persist results to PostgreSQL, and surface everything through a React operator dashboard.

---

## System diagram

```
External Sources
  (web forms, email, uploads)
          │
          ▼ HTTP POST
┌─────────────────────┐
│      n8n (5678)     │  ←─── Ollama (11434) — AI classification
│                     │
│  ┌───────────────┐  │
│  │ Customer      │  │
│  │ Intake v1     │  │──→ intake_log
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ Document      │  │──→ document_log
│  │ Intake v1     │  │
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ Appointment   │  │──→ appointment_log
│  │ Scheduling v1 │  │
│  └───────────────┘  │
└─────────────────────┘
          │
          ▼ SQL writes
┌─────────────────────┐
│   PostgreSQL (5433) │
│                     │
│   automation tables │  intake_log, document_log, appointment_log
│   shared tables     │  workflow_runs, audit_log, clients
│   views             │  v_recent_activity, v_daily_summary,
│                     │  v_workflow_health, v_client_summary
└─────────────────────┘
          │
          ▼ SQL reads
┌─────────────────────┐        ┌─────────────────────┐
│  Dashboard API      │◀──────▶│  React Client (80)  │
│  Express (3001)     │  HTTP  │  nginx + Vite build  │
└─────────────────────┘        └─────────────────────┘
```

---

## Component details

### n8n (workflow engine)

- Runs all three automation workflows
- Each workflow exposes a webhook endpoint as the entry point
- Internal node chain: Validate → Score/Classify → AI overlay → Route → Log
- Credentials (PostgreSQL, Gmail) stored encrypted in n8n's own DB schema (`n8n`)
- Workflow data (definitions, active state) stored in PostgreSQL schema `n8n`, database `qad_db`

### Ollama (local LLM)

- Runs `llama3.2` locally — no external API calls
- Used as a second-opinion classifier in all three automations
- Automations are designed to fail gracefully if Ollama is down: rule-based scores are used, and the result is flagged for human review
- n8n connects via `http://ollama:11434` inside the Docker network

### PostgreSQL (data spine)

Two logical database roles:

| Database | Schema | Used by |
|---|---|---|
| `qad_db` | `n8n` | n8n internal data (workflows, credentials, executions) |
| `qad` | `public` | Automation output data + dashboard views |

**Automation tables** (one per automation):
- `intake_log` — lead qualification results
- `document_log` — document classification results
- `appointment_log` — scheduling records

**Shared tables:**
- `workflow_runs` — one row per n8n execution (timing, status, business outcome)
- `audit_log` — immutable status-change record
- `clients` — soft client registry (no FK enforcement on automation tables)

**Views** (used by dashboard API):
- `v_recent_activity` — unified 200-row activity feed across all automations
- `v_daily_summary` — day × automation × status counts (last 90 days)
- `v_workflow_health` — success/failure/in-review rates per automation (last 30 days)
- `v_client_summary` — per-client totals across all automations

### Dashboard API (Express)

Thin Express server that translates HTTP requests from the React client into PostgreSQL queries. No business logic — all routing and scoring happens in n8n.

Routes:
- `GET /api/config` — client config (automation list, feature flags)
- `GET /api/overview` — KPI summary (run counts, success rates)
- `GET /api/automations` — per-automation health
- `GET /api/activity` — recent activity feed
- `GET /api/documents` — document queue
- `GET /api/calendar` — appointment records
- `GET /api/exceptions` — pending_review / human_review items
- `GET /api/reports` — aggregated stats for charts
- `POST /api/upload` — proxies document uploads to n8n webhook

### React Dashboard (nginx)

- Built with Vite + React + Tailwind CSS + Recharts
- Single-page app served by nginx at port 80
- nginx proxies `/api/*` to `http://api:3001` — browser never makes cross-origin requests
- `ClientConfigContext` is the single source of truth for automation metadata — no hardcoded automation names in components

---

## Data flow — Customer Intake example

```
POST /webhook/customer-intake
  { first_name, email, monthly_budget, ... }
        │
        ▼
[Validate Input]  — missing fields → HTTP 400
        │
        ▼
[Score Lead]      — rule-based: budget (0–30pts), timeline (0–20pts),
                    industry fit (0–15pts), pain points (0–20pts),
                    company (0–10pts), referral (0–5pts)
        │
        ▼
[Ollama Classify] — second opinion; low confidence → pending_review
        │
        ▼
[Route]           — score ≥ 80 → hot → schedule_call
                    score 50–79 → warm → send_info_packet
                    score < 50 → cold → do_not_pursue
        │
        ▼
[Log to DB]       — INSERT into intake_log + workflow_runs
        │
        ▼
[Email Alert]     — hot leads trigger Gmail notification
        │
        ▼
HTTP 200 { status, intake_id, qualification_tier, score }
```

---

## Classification confidence model

All three automations use the same hybrid scoring pattern:

| Signal combination | Confidence | Routing |
|---|---|---|
| Rule match + AI agree | 0.92 | Auto-process |
| Rule match only (AI down) | 0.75 | Auto-process with flag |
| Rule match + AI disagree | 0.65 | Human review |
| AI only (no rule match) | 0.55 | Human review |
| AI unavailable + rule miss | — | pending_review + ops alert |

---

## Network topology (Docker)

All containers share the `docker_qad-network` bridge network. DNS resolution uses container names as hostnames.

| From | To | Hostname | Port |
|---|---|---|---|
| n8n | postgres | `postgres` | 5432 |
| n8n | ollama | `ollama` | 11434 |
| api | postgres | `postgres` | 5432 |
| client (nginx) | api | `api` | 3001 |
| host | any service | `localhost` | mapped port |

The postgres container joins both the compose default network and `docker_qad-network` with the alias `postgres`. This ensures n8n (which was started before the compose alias existed) can resolve the hostname after any container recreation.

---

## Deployment shape

QAD uses **Shape 2** — one Docker stack per client. Multi-department support is handled via `client_id` in all tables, not via separate stacks. For a second client, clone the stack with different environment variables and port mappings.
