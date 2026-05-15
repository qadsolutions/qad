# Customer Delivery Guide

This guide walks through delivering QAD to a new customer — from pre-delivery information gathering through go-live sign-off. Follow it top to bottom. Each step is independent; tick it off before moving to the next.

---

## 1. Pre-delivery checklist

Gather the following from the customer before touching any code or servers.

### What you need from the customer

| Item | Why you need it | Example |
|---|---|---|
| Company name | Displayed in the dashboard sidebar | "Riverside Legal Group" |
| Slug / short ID | Unique identifier used throughout the system | `riverside_legal` |
| Primary brand color (hex) | Dashboard accent color | `#1E40AF` |
| Logo file (optional) | Shown in the sidebar (160×40px max, PNG/SVG) | `riverside_logo.png` |
| Which automations they want | Not every customer needs all three | customer intake + scheduling |
| Industry vertical | Used to tune lead scoring | "Legal / Professional Services" |
| Target budget threshold | Monthly budget below which leads are cold | $1,500 |
| Business hours | For appointment routing | Mon–Fri 09:00–18:00 EST |
| Email for notifications | Where hot leads and alerts get sent | `ops@riverside.com` |
| Gmail account for n8n | Must be the sending address | `automations@riverside.com` |
| Server or hosting details | Where Docker will run | AWS EC2 t3.medium, Ubuntu 22.04 |

---

## 2. Server setup

Follow the [Deployment Guide](deployment-guide.md) to get the Docker stack running on the customer's server.

**Minimum server specs:**
- 4 GB RAM (8 GB recommended if using Ollama GPU)
- 20 GB disk (more if storing documents)
- Docker Engine 24+ with Compose plugin
- Ports 80, 5678 open inbound (or behind a reverse proxy)

**Quick path (assuming Ubuntu):**
```bash
# On the customer's server
git clone <your-repo-url> qad && cd qad
cp .env.example .env
nano .env   # Fill in all values — see step 3
docker compose up -d
docker exec qad-ollama ollama pull llama3.2
```

Apply the database schema (first time only):
```bash
docker exec -i qad_postgres psql -U qad_user -d qad < data_spine/data_spine.sql
docker exec -i qad_postgres psql -U qad_user -d qad < automations/customer_intake_v1/postgres_schema.sql
docker exec -i qad_postgres psql -U qad_user -d qad < automations/document_intake_v1/postgres_schema.sql
docker exec -i qad_postgres psql -U qad_user -d qad < automations/appointment_scheduling_v1/postgres_schema.sql
```

---

## 3. Configure environment variables

Edit `.env` on the server with the customer's values:

```bash
# PostgreSQL
POSTGRES_DB=qad
POSTGRES_USER=qad_user
POSTGRES_PASSWORD=<strong-random-password>     # Generate: openssl rand -base64 24

# n8n
N8N_HOST=n8n.customer-domain.com              # or localhost for local deploy
N8N_ENCRYPTION_KEY=<random-32-char-string>    # Generate: openssl rand -base64 24
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=<strong-password>
WEBHOOK_URL=https://n8n.customer-domain.com/  # trailing slash required
GENERIC_TIMEZONE=America/Chicago              # customer's timezone
```

**Important:** Write down the `N8N_ENCRYPTION_KEY`. It is tied to the Docker volume and cannot be changed after first run without re-entering all credentials in n8n.

---

## 4. Create the client config file

Create a new JSON file at `dashboard/api/config/<client_slug>.json`. Copy from the template:

```bash
cp dashboard/api/config/acme_corp.json dashboard/api/config/riverside_legal.json
```

Edit it with the customer's details:

```json
{
  "client_id": "riverside_legal",
  "client_name": "Riverside Legal Group",
  "logo_url": "/assets/riverside_logo.png",
  "primary_color": "#1E40AF",
  "features_enabled": ["overview", "automations", "activity", "calendar", "exceptions", "reports", "settings"],
  "automations": [
    {
      "id": "intake",
      "label": "Client Intake",
      "description": "Qualifies and routes inbound client enquiries",
      "icon": "UserCheck",
      "webhook": "/webhook/customer-intake",
      "db_table": "intake_log",
      "workflow_id": "customer_intake_v1",
      "status_field": "qualification_tier",
      "nav_sections": ["activity", "exceptions", "reports"],
      "report_metrics": ["total_leads", "tier_breakdown", "avg_score"]
    },
    {
      "id": "appointments",
      "label": "Consultation Scheduling",
      "description": "Books and manages client consultations",
      "icon": "CalendarCheck",
      "webhook": "/webhook/appointment",
      "db_table": "appointment_log",
      "workflow_id": "appointment_scheduling_v1",
      "status_field": "status",
      "nav_sections": ["calendar", "activity", "exceptions", "reports"],
      "report_metrics": ["total_appointments", "status_breakdown", "auto_confirm_rate"]
    }
  ]
}
```

**Features list** — remove any section the customer doesn't need:
`overview`, `automations`, `activity`, `documents`, `tasks`, `calendar`, `exceptions`, `reports`, `settings`

If you remove `documents`, the Documents nav item disappears entirely (not just empty — fully absent from the UI).

---

## 5. Set the default client in the dashboard

The React app reads `?client_id=` from the URL and falls back to `acme_corp`. For a dedicated customer deployment, update the default in one place:

**File:** `dashboard/client/src/context/ClientConfigContext.jsx`

```js
// Change this line:
const clientId = new URLSearchParams(window.location.search).get('client_id') || 'acme_corp';

// To:
const clientId = new URLSearchParams(window.location.search).get('client_id') || 'riverside_legal';
```

Then rebuild the client container:
```bash
docker compose build client
docker compose up -d client
```

---

## 6. Upload the customer's logo (optional)

Place the logo file in `dashboard/client/public/assets/`:
```bash
cp riverside_logo.png dashboard/client/public/assets/
```

Set `logo_url` in the client config to `/assets/riverside_logo.png`.

Rebuild the client container after adding the file.

---

## 7. Register the client in the database

```bash
docker exec qad_postgres psql -U qad_user -d qad -c "
INSERT INTO clients (client_id, client_name, industry, contact_email, timezone)
VALUES (
  'riverside_legal',
  'Riverside Legal Group',
  'Legal',
  'ops@riverside.com',
  'America/Chicago'
);
"
```

This enables the `v_client_summary` view to return per-client stats in the dashboard.

---

## 8. Customize the n8n workflows

Log into n8n at `http://server:5678` and import the workflow files from `automations/*/workflow_upload.json`.

### 8a. Customer Intake — tune the scoring

Open the **"Score Lead"** Code node in the Customer Intake workflow. Update the arrays to match the customer's industry and target criteria:

```javascript
// Industries that score full points (edit to match customer's targets)
const targetIndustries = ['Legal', 'Professional Services', 'Finance', 'Healthcare'];

// Monthly budget threshold for "warm" (min budget that qualifies)
const warmBudgetMin = 1500;  // customer said $1,500

// Budget tiers (adjust to customer's pricing model)
if (budget >= 5000) budgetScore = 30;
else if (budget >= 2000) budgetScore = 20;
else if (budget >= 1500) budgetScore = 10;
else budgetScore = 0;
```

Also update the **notification email** in the "Send Hot Lead Alert" node to the customer's ops email address.

### 8b. Appointment Scheduling — set business hours

Open the **"Check Business Hours"** Code node. Update the hours and timezone:

```javascript
// Business hours (UTC — convert from customer's local timezone)
const businessHoursStart = 14;  // 09:00 EST = 14:00 UTC
const businessHoursEnd = 23;    // 18:00 EST = 23:00 UTC
const businessDays = [1, 2, 3, 4, 5];  // Mon–Fri (0=Sun, 6=Sat)
```

Update the **confirmation email** templates with the customer's business name and contact details.

### 8c. Set client_id in all workflows

In each workflow, find the **"Prepare Log Data"** Code node and update:
```javascript
const client_id = 'riverside_legal';  // was 'default'
```

This tags all database records with the customer's ID.

---

## 9. Configure n8n credentials

In n8n, go to **Credentials** and create:

**PostgreSQL credential:**
- Name: `postgres_main`
- Host: `postgres` (internal Docker hostname)
- Port: `5432`
- Database: `qad`
- User: `qad_user`
- Password: (from `.env`)

**Gmail OAuth2 credential:**
- Name: `gmail_oauth2`
- Follow n8n's OAuth2 setup wizard
- Use the customer's `automations@riverside.com` Gmail account
- Requires a Google Cloud project with Gmail API enabled

Update each workflow to use these credentials (check the PostgreSQL and Gmail nodes).

---

## 10. Activate the workflows

In n8n, activate each workflow the customer purchased. After activation, check the logs:

```bash
docker logs qad-n8n | grep "Activated workflow"
```

You should see one line per active workflow.

---

## 11. Smoke test

Run a test submission for each active automation:

**Customer Intake:**
```bash
curl -X POST https://n8n.customer-domain.com/webhook/customer-intake \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Test",
    "last_name": "Client",
    "email": "test@delivery-check.com",
    "industry": "Legal",
    "business_description": "Law firm looking to automate client intake",
    "pain_points": "Manual intake takes 3 days and loses leads",
    "monthly_budget": 3000,
    "timeline": "immediate"
  }'
```

Expected: `{ "qualification_tier": "warm", ... }` or `"hot"` depending on scoring.

**Appointment:**
```bash
curl -X POST https://n8n.customer-domain.com/webhook/appointment \
  -H "Content-Type: application/json" \
  -d '{
    "contact_email": "test@delivery-check.com",
    "service_type": "consultation",
    "requested_time": "2026-06-10T15:00:00Z",
    "request_type": "book",
    "source_type": "web"
  }'
```

Expected: `{ "status": "confirmed" }` (if within business hours).

Open the dashboard and confirm the test rows appear in the Activity feed.

**Delete the test rows after verification:**
```bash
docker exec qad_postgres psql -U qad_user -d qad -c "
DELETE FROM intake_log WHERE contact_email = 'test@delivery-check.com';
DELETE FROM appointment_log WHERE contact_email = 'test@delivery-check.com';
DELETE FROM workflow_runs WHERE execution_id IN (
  SELECT execution_id FROM workflow_runs WHERE created_at > NOW() - INTERVAL '1 hour'
);
"
```

---

## 12. DNS and SSL

Point the customer's domain(s) to the server and configure SSL. See [Deployment Guide — SSL section](deployment-guide.md#ssl--reverse-proxy).

Typical setup:
- `app.customer-domain.com` → port 80 (React dashboard)
- `n8n.customer-domain.com` → port 5678 (n8n editor, restrict access)

Restrict n8n to staff IPs only in production — it should never be publicly browsable.

---

## 13. Handoff package

Deliver the following to the customer:

### Credentials document (store securely — use 1Password or similar)

```
QAD Platform — Riverside Legal Group
=====================================
Dashboard URL:     https://app.riverside.com
n8n URL:           https://n8n.riverside.com (staff only)
n8n login:         admin / <password>
Database password: <password>

Webhooks (for integrating your website/CRM):
  Lead intake:    POST https://n8n.riverside.com/webhook/customer-intake
  Appointments:   POST https://n8n.riverside.com/webhook/appointment

Emergency contacts:
  Technical support: <your contact>
```

### Documents to hand over

- `docs/operator-guide.md` — printed or shared as PDF for the ops team
- Webhook schema reference — `automations/customer_intake_v1/schema.md` and `automations/appointment_scheduling_v1/schema.md` — for their dev team integrating the webhooks
- Backup schedule — confirm with customer how often DB backups run

---

## 14. Go-live checklist

Run through this checklist with the customer before leaving:

- [ ] Dashboard loads at production URL with customer branding
- [ ] All purchased automations show as "Active" on the Automations page
- [ ] Test lead submission appears in Activity feed with correct tier
- [ ] Test appointment appears in Calendar
- [ ] Hot lead email notification arrives at customer's ops email
- [ ] Exceptions page is empty (no leftover test data)
- [ ] Customer staff can log in and navigate all dashboard sections
- [ ] Customer has the credentials document stored securely
- [ ] Customer has the operator guide
- [ ] Backup plan confirmed (cron job or managed backup service)
- [ ] n8n editor access restricted to staff IPs or VPN
- [ ] `docker compose restart` tested — all containers come back up cleanly

---

## 15. Post-delivery

### 30-day check-in
Review with the customer:
- Success rates in the Reports page — are they meeting expectations?
- Any recurring exceptions that need workflow tuning?
- Volume vs. their projections — do they need to adjust thresholds?

### Workflow tuning
If leads are scoring too high or too low, adjust the budget/industry arrays in the Score Lead node and re-activate the workflow. No downtime required.

### Adding a second automation later
If the customer later wants to add Document Processing:
1. Add it to their `client_config.json` (add to `features_enabled` and `automations` arrays)
2. Apply the document schema: `psql < automations/document_intake_v1/postgres_schema.sql`
3. Import the document workflow in n8n and activate it
4. Rebuild the client container
