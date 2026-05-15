# Operator Guide — QAD Dashboard

This guide covers day-to-day operation of the QAD platform for staff who manage the automations and review incoming data.

---

## Dashboard sections

### Overview (`/`)

The main landing page. Shows:
- **Total runs** — executions across all automations in the last 30 days
- **Success rate** — percentage of runs that resolved without human review
- **Per-automation health cards** — status, run count, success rate
- **Activity feed** — last 10 records across all automations

If success rate drops below expected levels, check the Exceptions page for a queue of items needing review.

### Automations (`/automations`)

Lists all three automations with their current status (Active / Inactive) and a health summary. Click an automation to see its recent runs and configuration.

**If an automation shows Inactive:** log in to n8n at `http://localhost:5678`, find the workflow, and click the toggle to re-activate it.

### Activity Feed (`/activity`)

Unified timeline of every record processed — leads, documents, and appointments. Filter by automation or status. Click a row to open the detail drawer with the full record.

**Status badges:**
- `hot` / `warm` — qualified leads
- `cold` — low-priority leads, no outreach
- `auto_process` — document routed automatically
- `confirmed` / `rescheduled` / `cancelled` — appointment states
- `pending_review` / `human_review` — needs staff attention (see Exceptions)

### Documents (`/documents`)

Shows all documents that have been processed. Documents with `human_review` status are waiting for a staff member to confirm or override the classification. Use the Upload button to submit a new document directly from the dashboard.

**Document types the system classifies:**
invoice, contract, referral, receipt, intake_form, court_document, id_document, tax_document, real_estate, correspondence

### Calendar (`/calendar`)

All appointments in a timeline view. Appointments in `pending_review` (outside business hours, urgent, or ambiguous) appear highlighted and require staff to confirm or reassign.

**Business hours:** Monday–Saturday, 09:00–17:00 UTC (configurable in the workflow). Sunday bookings always route to pending review.

### Exceptions (`/exceptions`)

The action queue. Every record in `pending_review` or `human_review` state appears here. This is the primary place for daily staff review.

**Common exception causes:**
- **Lead:** Ollama confidence below threshold, or AI and rules disagreed
- **Document:** Low confidence score, document type ambiguous, or court document (always escalated)
- **Appointment:** Outside business hours, urgent booking, or natural language inquiry

### Reports (`/reports`)

Charts and statistics for each automation. Shows volume over time, status breakdowns, and success rates. Date range defaults to last 30 days.

### Settings (`/settings`)

Displays the current client configuration: automation list, feature flags, and connection status.

---

## Daily checklist

1. **Check Exceptions** — Clear the `pending_review` queue. Aim for zero by end of day.
2. **Check Overview success rate** — If below 70% for any automation, investigate in n8n.
3. **Check Documents** — Any `human_review` documents need classification confirmation.
4. **Check Calendar** — Confirm or reschedule any pending appointments.

---

## Managing clients

Each record is tagged with a `client_id`. The default client is `default`. To register a new department or team:

```sql
INSERT INTO clients (client_id, client_name, industry, contact_email)
VALUES ('acme_sales', 'ACME Sales Team', 'SaaS', 'ops@acme.com');
```

The automation workflows use `client_id` when logging runs. Update the workflow's "Prepare Log Data" node to pass the correct `client_id` for each deployment.

---

## Handling a failed automation

**Symptom:** Webhook returns an error or records stop appearing in the activity feed.

1. Check n8n at `http://localhost:5678` → Executions — look for failed runs and read the error node
2. Confirm PostgreSQL is reachable: `docker exec qad_postgres pg_isready -U qad_user -d qad`
3. Confirm Ollama is running: `curl http://localhost:11434/api/version`
4. If n8n workflows show as Inactive, re-activate them in the n8n editor
5. Re-run the failed submission manually via the webhook

---

## Re-activating workflows after a restart

If the Docker stack is restarted (`docker compose down && docker compose up -d`), n8n re-activates workflows automatically on startup. You should see in the logs:

```
Activated workflow "Customer Intake & Qualification v1"
Activated workflow "Document Intake & Processing Agent v1"
Activated workflow "Appointment & Scheduling Automation v1"
```

If a workflow fails to activate, open n8n, find the workflow, and toggle it manually.

---

## Resetting test data

To clear fixture test data from the database (keep schema, drop rows):

```bash
docker exec qad_postgres psql -U qad_user -d qad -c "
  TRUNCATE intake_log, document_log, appointment_log, workflow_runs, audit_log RESTART IDENTITY;
"
```

---

## n8n access

- URL: `http://localhost:5678`
- Credentials: see `.env` → `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD`
- API Key: see `.env` → `N8N_API_KEY`

Do not edit workflows in n8n without first saving a copy — there is no undo history beyond the n8n version control panel.
