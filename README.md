# QAD — Automation Dashboard

QAD is a deployable business automation platform built on n8n, PostgreSQL, and React. It ships three production-ready automations with a shared data spine and an operator dashboard — all running in Docker.

## What's included

| Automation | Webhook | What it does |
|---|---|---|
| Customer Intake & Qualification | `POST /webhook/customer-intake` | Scores and routes inbound leads (hot / warm / cold) using rule-based scoring + Ollama AI |
| Document Intake & Processing | `POST /webhook/document-intake` | Classifies documents (invoice, contract, referral, etc.) and routes them to the right queue |
| Appointment Scheduling | `POST /webhook/appointment` | Handles bookings, rescheduling, cancellations, and conflict detection against existing appointments |

The **operator dashboard** (React + nginx) shows live activity, automation health, document queue, calendar, exceptions, and reports — all wired to the same PostgreSQL database the automations write to.

---

## Quick start

### Prerequisites
- Docker Desktop (Windows/Mac/Linux)
- Git

### 1. Clone and configure

```bash
git clone <repo-url> qad
cd qad
cp .env.example .env
# Edit .env — change passwords before production use
```

### 2. Start the stack

```bash
docker compose up -d
```

This starts all 5 services. First run pulls images and builds the dashboard (~2 minutes).

### 3. Pull the AI model

The automations use Ollama (llama3.2) for classification. Pull the model once after first start:

```bash
docker exec qad-ollama ollama pull llama3.2
```

### 4. Apply the database schema

```bash
docker exec -i qad_postgres psql -U qad_user -d qad < data_spine/data_spine.sql
docker exec -i qad_postgres psql -U qad_user -d qad < automations/customer_intake_v1/postgres_schema.sql
docker exec -i qad_postgres psql -U qad_user -d qad < automations/document_intake_v1/postgres_schema.sql
docker exec -i qad_postgres psql -U qad_user -d qad < automations/appointment_scheduling_v1/postgres_schema.sql
```

### 5. Import n8n workflows

1. Open n8n at `http://localhost:5678`
2. Log in with the credentials in your `.env` file
3. Import each workflow file from `automations/*/workflow_upload.json`
4. Configure the PostgreSQL and Gmail credentials in n8n
5. Activate all three workflows

### 6. Access the dashboard

Open `http://localhost` — the React dashboard is served at port 80.

---

## Services

| Container | Purpose | Port |
|---|---|---|
| `qad_postgres` | PostgreSQL 16 | 5433 (host) |
| `qad-n8n` | n8n workflow engine | 5678 |
| `qad-ollama` | Ollama LLM (llama3.2) | 11434 |
| `qad-dashboard-api` | Express API for the dashboard | 3001 |
| `qad-client` | React dashboard (nginx) | 80 |

---

## Project structure

```
qad/
├── automations/
│   ├── customer_intake_v1/      # Lead qualification automation
│   ├── document_intake_v1/      # Document processing automation
│   └── appointment_scheduling_v1/  # Scheduling automation
├── dashboard/
│   ├── api/                     # Express API (routes, db.js)
│   └── client/                  # React app (Vite + Tailwind)
├── data_spine/
│   ├── data_spine.sql           # Shared tables + views (idempotent)
│   └── seed_dev.sql             # Development seed data
├── docs/                        # Architecture, operator, deployment guides
├── docker-compose.yml           # Full stack definition
├── .env.example                 # Environment variable template
└── CLAUDE.md                    # Agent build instructions (internal)
```

---

## Documentation

| Doc | Description |
|---|---|
| [Architecture](docs/architecture.md) | System design, data flow, component relationships |
| [Operator Guide](docs/operator-guide.md) | Day-to-day operation, dashboard walkthrough, exception handling |
| [Deployment Guide](docs/deployment-guide.md) | Production setup, environment variables, domain config |
| [CHANGELOG](CHANGELOG.md) | Phase-by-phase build history |
| [Data Spine](data_spine/README.md) | Database schema reference |
| [Customer Intake](automations/customer_intake_v1/README.md) | Automation docs |
| [Document Intake](automations/document_intake_v1/schema.md) | Input/output schema |
| [Appointment Scheduling](automations/appointment_scheduling_v1/README.md) | Automation docs |

---

## Development

### Run without Docker

```bash
# Terminal 1 — API
cd dashboard/api
npm install
node index.js

# Terminal 2 — Client
cd dashboard/client
npm install
npm run dev
```

API runs at `http://localhost:3001`, client at `http://localhost:5173` (proxied to API).

Requires a running PostgreSQL instance. See `.env.example` for connection defaults.

### Environment variables

See `.env.example` for the full list. Key variables:

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | `changeme` | **Change in production** |
| `N8N_ENCRYPTION_KEY` | (see file) | **Change in production** — must match existing n8n volume |
| `N8N_BASIC_AUTH_PASSWORD` | `qadpass123` | **Change in production** |
| `WEBHOOK_URL` | `http://localhost:5678/` | Set to your public URL in production |
