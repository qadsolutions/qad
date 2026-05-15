-- ============================================================
-- Customer Intake & Qualification v1 — PostgreSQL Schema
-- Run this before activating the workflow.
-- ============================================================

-- Main intake log (one row per submission)
CREATE TABLE IF NOT EXISTS intake_log (
  id                    BIGSERIAL PRIMARY KEY,
  intake_id             TEXT NOT NULL UNIQUE,
  execution_id          TEXT,
  workflow_version      TEXT DEFAULT 'customer_intake_v1',
  client_id             TEXT DEFAULT 'default',

  -- Source
  source_type           TEXT,
  source_channel        TEXT,

  -- Contact
  contact_name          TEXT,
  contact_email         TEXT,
  contact_phone         TEXT,
  company_name          TEXT,

  -- Request
  request_type          TEXT,
  service_category      TEXT,
  urgency_level         TEXT,
  monthly_budget        NUMERIC(12,2) DEFAULT 0,
  message_body          TEXT,

  -- Raw & normalized payloads
  raw_payload           JSONB,
  normalized_payload    JSONB,

  -- Validation
  validation_passed     BOOLEAN,
  validation_errors     JSONB DEFAULT '[]',
  is_spam               BOOLEAN DEFAULT FALSE,
  is_duplicate          BOOLEAN DEFAULT FALSE,

  -- AI classification
  classification_result JSONB,
  confidence_score      NUMERIC(5,4) DEFAULT 0,
  ai_model_used         TEXT,
  ai_model_source       TEXT,
  ai_response_time_ms   INTEGER DEFAULT 0,
  ai_fallback_used      BOOLEAN DEFAULT FALSE,

  -- Qualification
  qualification_score   INTEGER DEFAULT 0,
  qualification_tier    TEXT,   -- hot | warm | cold | disqualified | pending_review | invalid
  recommended_action    TEXT,   -- schedule_call | send_info_packet | add_to_nurture | do_not_pursue | human_review

  -- Routing
  route_taken           TEXT,
  human_review_needed   BOOLEAN DEFAULT FALSE,
  flags                 JSONB DEFAULT '[]',

  -- Timestamps
  received_at           TIMESTAMPTZ,
  processed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow error log (shared across all automations)
CREATE TABLE IF NOT EXISTS workflow_errors (
  id             BIGSERIAL PRIMARY KEY,
  execution_id   TEXT,
  workflow_id    TEXT NOT NULL,
  error_type     TEXT,  -- validation | transient | fatal
  error_message  TEXT,
  failed_at      TIMESTAMPTZ DEFAULT NOW(),
  retry_count    INTEGER DEFAULT 0,
  resolved       BOOLEAN DEFAULT FALSE,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_intake_log_tier       ON intake_log (qualification_tier);
CREATE INDEX IF NOT EXISTS idx_intake_log_client     ON intake_log (client_id);
CREATE INDEX IF NOT EXISTS idx_intake_log_received   ON intake_log (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_log_email      ON intake_log (contact_email);
CREATE INDEX IF NOT EXISTS idx_workflow_errors_wf    ON workflow_errors (workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_errors_unres ON workflow_errors (resolved) WHERE resolved = FALSE;
