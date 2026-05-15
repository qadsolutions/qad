-- ============================================================
-- Data Spine — Phase 2
-- Shared tables, audit infrastructure, and dashboard views.
-- Run once before Phase 3 connectivity testing.
-- Safe to re-run: all statements are idempotent.
-- ============================================================

-- ── CLIENTS ────────────────────────────────────────────────
-- Soft reference table. No FK constraints on the automation
-- tables — client_id is a label, not an enforced relation.
CREATE TABLE IF NOT EXISTS clients (
  client_id       TEXT PRIMARY KEY,
  client_name     TEXT NOT NULL,
  industry        TEXT,
  contact_name    TEXT,
  contact_email   TEXT,
  timezone        TEXT DEFAULT 'UTC',
  active          BOOLEAN DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the default client so existing test rows resolve
INSERT INTO clients (client_id, client_name, notes)
VALUES ('default', 'Default Client', 'Auto-seeded. Update with real client details before go-live.')
ON CONFLICT (client_id) DO NOTHING;

-- ── WORKFLOW_RUNS ──────────────────────────────────────────
-- One row per workflow execution. Matches the Phase 0 logging
-- schema: execution ID, start/end, duration, outcome metric.
CREATE TABLE IF NOT EXISTS workflow_runs (
  id                      BIGSERIAL PRIMARY KEY,
  execution_id            TEXT NOT NULL UNIQUE,
  workflow_id             TEXT NOT NULL,
  workflow_name           TEXT,
  workflow_version        TEXT,
  client_id               TEXT DEFAULT 'default',

  -- Timing
  started_at              TIMESTAMPTZ NOT NULL,
  ended_at                TIMESTAMPTZ,
  duration_ms             INTEGER,

  -- Outcome
  run_status              TEXT DEFAULT 'unknown',  -- success | failure | partial
  error_message           TEXT,

  -- AI / API usage
  token_usage             JSONB DEFAULT '{}',       -- { input: N, output: N }
  api_calls               JSONB DEFAULT '[]',       -- [ { service, endpoint, status_code, duration_ms } ]
  ollama_used             BOOLEAN DEFAULT FALSE,
  ollama_fallback         BOOLEAN DEFAULT FALSE,

  -- Business outcome (automation-specific)
  source_type             TEXT,
  business_outcome        TEXT,   -- e.g. lead_qualified | document_routed | appointment_confirmed
  business_outcome_detail JSONB DEFAULT '{}',       -- e.g. { score: 85, tier: "hot" }

  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_workflow    ON workflow_runs (workflow_id);
CREATE INDEX IF NOT EXISTS idx_runs_client      ON workflow_runs (client_id);
CREATE INDEX IF NOT EXISTS idx_runs_status      ON workflow_runs (run_status);
CREATE INDEX IF NOT EXISTS idx_runs_started     ON workflow_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_outcome     ON workflow_runs (business_outcome);

-- ── WORKFLOW_ERRORS (extend existing) ─────────────────────
-- Backfill columns that may not exist from the initial create.
DO $$ BEGIN
  ALTER TABLE workflow_errors ADD COLUMN client_id  TEXT DEFAULT 'default';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE workflow_errors ADD COLUMN node_name  TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE workflow_errors ADD COLUMN workflow_name TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ── AUDIT_LOG ──────────────────────────────────────────────
-- Immutable record of every status change across all three
-- automation tables. Written by workflows at key transitions.
-- No triggers — workflows write explicitly for traceability.
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  automation      TEXT NOT NULL,  -- customer_intake_v1 | document_intake_v1 | appointment_scheduling_v1
  record_id       TEXT NOT NULL,  -- intake_id / document_id / appointment_id
  client_id       TEXT DEFAULT 'default',

  event_type      TEXT NOT NULL,  -- status_change | created | updated | error | escalated
  old_status      TEXT,
  new_status      TEXT,

  triggered_by    TEXT,           -- workflow_id or 'staff' or 'system'
  execution_id    TEXT,

  detail          JSONB DEFAULT '{}',  -- any extra context (e.g. conflict_details, score)
  changed_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_record      ON audit_log (record_id);
CREATE INDEX IF NOT EXISTS idx_audit_client      ON audit_log (client_id);
CREATE INDEX IF NOT EXISTS idx_audit_automation  ON audit_log (automation);
CREATE INDEX IF NOT EXISTS idx_audit_event       ON audit_log (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_time        ON audit_log (changed_at DESC);

-- ── VIEWS ─────────────────────────────────────────────────

-- v_recent_activity
-- Unified feed of the last 200 records across all three automations.
-- Used by the dashboard activity feed.
CREATE OR REPLACE VIEW v_recent_activity AS
SELECT
  'customer_intake'                                    AS automation,
  intake_id                                            AS record_id,
  client_id,
  source_type,
  COALESCE(qualification_tier, route_taken, 'unknown') AS status,
  contact_email,
  service_category                                     AS service_type,
  NULL::TIMESTAMPTZ                                    AS scheduled_time,
  received_at                                          AS activity_time,
  processed_at
FROM intake_log

UNION ALL

SELECT
  'document_intake'     AS automation,
  document_id           AS record_id,
  client_id,
  source_type,
  COALESCE(processing_status, downstream_action, 'unknown') AS status,
  sender                AS contact_email,
  classification_label  AS service_type,
  NULL::TIMESTAMPTZ     AS scheduled_time,
  received_at           AS activity_time,
  processed_at
FROM document_log

UNION ALL

SELECT
  'appointment_scheduling' AS automation,
  appointment_id           AS record_id,
  client_id,
  source_type,
  status,
  contact_email,
  service_type,
  confirmed_time           AS scheduled_time,
  received_at              AS activity_time,
  processed_at
FROM appointment_log

ORDER BY activity_time DESC NULLS LAST
LIMIT 200;

-- v_daily_summary
-- Row-per-day-per-automation count summary for dashboard charts.
-- Queries source tables directly (not v_recent_activity) to avoid
-- the LIMIT 200 cap on the activity feed causing silent undercounting.
CREATE OR REPLACE VIEW v_daily_summary AS
SELECT DATE_TRUNC('day', received_at) AS day, 'customer_intake' AS automation,
       COALESCE(qualification_tier, route_taken, 'unknown') AS status, COUNT(*) AS total
FROM intake_log WHERE received_at >= NOW() - INTERVAL '90 days'
GROUP BY 1, 3
UNION ALL
SELECT DATE_TRUNC('day', received_at) AS day, 'document_intake' AS automation,
       COALESCE(processing_status, downstream_action, 'unknown') AS status, COUNT(*) AS total
FROM document_log WHERE received_at >= NOW() - INTERVAL '90 days'
GROUP BY 1, 3
UNION ALL
SELECT DATE_TRUNC('day', received_at) AS day, 'appointment_scheduling' AS automation,
       status, COUNT(*) AS total
FROM appointment_log WHERE received_at >= NOW() - INTERVAL '90 days'
GROUP BY 1, 3
ORDER BY 1 DESC, 2, 3;

-- v_workflow_health
-- Error rate and success rate per workflow over the last 30 days.
CREATE OR REPLACE VIEW v_workflow_health AS
SELECT
  automation,
  COUNT(*)                                              AS total_runs,
  COUNT(*) FILTER (WHERE status IN (
    'hot','warm',
    'success','auto_process',
    'confirmed','rescheduled','cancelled'
  ))                                                    AS successful,
  COUNT(*) FILTER (WHERE status IN (
    'cold','disqualified','rejected','failed','error'
  ))                                                    AS failed,
  COUNT(*) FILTER (WHERE status IN (
    'pending_review','human_review','pending'
  ))                                                    AS in_review,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status IN (
      'hot','warm',
      'success','auto_process',
      'confirmed','rescheduled','cancelled'
    )) / NULLIF(COUNT(*), 0), 1
  )                                                     AS success_rate_pct
FROM v_recent_activity
WHERE activity_time >= NOW() - INTERVAL '30 days'
GROUP BY automation
ORDER BY automation;

-- v_client_summary
-- Per-client row counts across all automations.
-- Useful for the operator overview panel.
CREATE OR REPLACE VIEW v_client_summary AS
SELECT
  c.client_id,
  c.client_name,
  c.active,
  COUNT(DISTINCT i.intake_id)       AS total_intakes,
  COUNT(DISTINCT d.document_id)     AS total_documents,
  COUNT(DISTINCT a.appointment_id)  AS total_appointments,
  GREATEST(
    MAX(i.received_at),
    MAX(d.received_at),
    MAX(a.received_at)
  )                                 AS last_activity_at
FROM clients c
LEFT JOIN intake_log      i ON i.client_id = c.client_id
LEFT JOIN document_log    d ON d.client_id = c.client_id
LEFT JOIN appointment_log a ON a.client_id = c.client_id
GROUP BY c.client_id, c.client_name, c.active
ORDER BY last_activity_at DESC NULLS LAST;
