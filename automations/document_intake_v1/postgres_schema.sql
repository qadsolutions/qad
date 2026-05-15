-- ============================================================
-- Document Intake & Processing Agent v1 — PostgreSQL Schema
-- Run this before activating the workflow.
-- ============================================================

CREATE TABLE IF NOT EXISTS document_log (
  id                      BIGSERIAL PRIMARY KEY,
  document_id             TEXT NOT NULL UNIQUE,
  execution_id            TEXT,
  workflow_version        TEXT DEFAULT 'document_intake_v1',
  client_id               TEXT DEFAULT 'default',

  -- Source
  source_type             TEXT,
  source_channel          TEXT,
  sender                  TEXT,
  subject                 TEXT,

  -- File metadata
  file_name               TEXT,
  file_type               TEXT,
  mime_type               TEXT,
  file_size               INTEGER,

  -- Content
  document_text           TEXT,
  raw_payload             JSONB,
  normalized_payload      JSONB,

  -- Validation
  validation_passed       BOOLEAN,
  validation_errors       JSONB DEFAULT '[]',

  -- Classification
  classification_label    TEXT,
  confidence_score        NUMERIC(5,4) DEFAULT 0,
  classification_result   JSONB,

  -- Extraction
  extracted_fields        JSONB,

  -- Filing & routing
  filing_target           TEXT,
  downstream_action       TEXT,
  review_required         BOOLEAN DEFAULT FALSE,
  processing_status       TEXT,

  -- AI
  ai_model_used           TEXT,
  ai_model_source         TEXT,
  ai_response_time_ms     INTEGER DEFAULT 0,
  ai_fallback_used        BOOLEAN DEFAULT FALSE,

  -- Error
  error_message           TEXT,

  -- Timestamps
  received_at             TIMESTAMPTZ,
  processed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_doc_log_client      ON document_log (client_id);
CREATE INDEX IF NOT EXISTS idx_doc_log_class       ON document_log (classification_label);
CREATE INDEX IF NOT EXISTS idx_doc_log_status      ON document_log (processing_status);
CREATE INDEX IF NOT EXISTS idx_doc_log_review      ON document_log (review_required) WHERE review_required = TRUE;
CREATE INDEX IF NOT EXISTS idx_doc_log_received    ON document_log (received_at DESC);
