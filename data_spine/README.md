# Data Spine — Phase 2

Shared PostgreSQL infrastructure that ties all three automations together and supports the React dashboard.

## Apply Order

```powershell
# 1. Run once — creates tables and views
docker cp data_spine/data_spine.sql qad_postgres:/tmp/data_spine.sql
docker exec qad_postgres psql -U qad_user -d qad -f /tmp/data_spine.sql

# 2. Development only — seed test clients
docker cp data_spine/seed_dev.sql qad_postgres:/tmp/seed_dev.sql
docker exec qad_postgres psql -U qad_user -d qad -f /tmp/seed_dev.sql
```

Safe to re-run — all statements use `IF NOT EXISTS` or `OR REPLACE`.

## Tables

### `clients`
Soft client registry. `client_id` is a TEXT label used by all automation tables — no FK enforcement. Register clients here so they appear in `v_client_summary`.

| Column | Description |
|---|---|
| `client_id` | Primary key — matches what automations send |
| `client_name` | Display name |
| `industry` | Optional |
| `timezone` | IANA timezone string |
| `active` | Soft-delete flag |

**To add a client:**
```sql
INSERT INTO clients (client_id, client_name, industry, timezone)
VALUES ('my_client', 'My Client Name', 'Healthcare', 'America/New_York');
```

### `workflow_runs`
One row per n8n execution. Captures the Phase 0 logging schema: execution ID, timing, outcome, AI/API usage. Automations should write here on completion (Phase 3 wires this up).

Key fields: `execution_id`, `workflow_id`, `started_at`, `ended_at`, `duration_ms`, `run_status`, `business_outcome`, `business_outcome_detail` (JSONB), `token_usage` (JSONB), `api_calls` (JSONB).

### `workflow_errors`
One row per error event. Written by the `Error Handler` node in each automation. Extended in Phase 2 to add `client_id`, `node_name`, `workflow_name`.

### `audit_log`
Immutable status-change record across all three automations. Written explicitly by workflows at key transitions (not via triggers). Fields: `automation`, `record_id`, `event_type`, `old_status`, `new_status`, `triggered_by`, `detail` (JSONB).

## Views

### `v_recent_activity`
Unified feed of the last 200 records across all three automation tables. Used by the dashboard activity feed.

```sql
SELECT * FROM v_recent_activity LIMIT 20;
```

Columns: `automation`, `record_id`, `client_id`, `source_type`, `status`, `contact_email`, `service_type`, `scheduled_time`, `activity_time`, `processed_at`.

### `v_daily_summary`
Row-per-day-per-automation-per-status counts. Use for time-series charts on the dashboard. Covers the last 90 days.

```sql
SELECT * FROM v_daily_summary WHERE automation = 'appointment_scheduling';
```

### `v_workflow_health`
Aggregated success/failure/in-review counts per automation over the last 30 days, with `success_rate_pct`.

```sql
SELECT * FROM v_workflow_health;
```

### `v_client_summary`
Per-client totals across all automations. Only shows clients registered in the `clients` table (soft reference). Use to populate the operator overview panel.

```sql
SELECT * FROM v_client_summary;
```

## Status Normalization
Each automation uses different status vocabulary. `v_recent_activity` surfaces them as-is. `v_workflow_health` maps them:

| Category | intake_log | document_log | appointment_log |
|---|---|---|---|
| Successful | `hot`, `warm` | `success`, `auto_process` | `confirmed`, `rescheduled`, `cancelled` |
| Failed | `disqualified`, `rejected` | `failed`, `error`, `rejected` | `rejected`, `error` |
| In Review | `pending_review` | `human_review`, `pending_review` | `pending_review`, `pending` |

## Schema Diagram
```
clients (soft reference — no FK constraints)
    │
    ├── intake_log        (customer_intake_v1)
    ├── document_log      (document_intake_v1)
    └── appointment_log   (appointment_scheduling_v1)

workflow_runs    (one row per execution — all workflows)
workflow_errors  (one row per error — all workflows)
audit_log        (one row per status change — all workflows)

Views:
  v_recent_activity  ← UNION of all three automation tables
  v_daily_summary    ← v_recent_activity GROUP BY day, automation, status
  v_workflow_health  ← v_recent_activity GROUP BY automation (last 30d)
  v_client_summary   ← clients LEFT JOIN all three tables
```
