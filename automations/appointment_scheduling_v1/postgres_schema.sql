-- ============================================================
-- Appointment & Scheduling Automation v1 — PostgreSQL Schema
-- Run this before activating the workflow.
-- ============================================================

CREATE TABLE IF NOT EXISTS appointment_log (
  id                          BIGSERIAL PRIMARY KEY,
  appointment_id              TEXT NOT NULL UNIQUE,
  execution_id                TEXT,
  workflow_version            TEXT DEFAULT 'appointment_scheduling_v1',
  client_id                   TEXT DEFAULT 'default',

  -- Request metadata
  request_type                TEXT,                         -- book | reschedule | cancel | inquiry
  source_type                 TEXT,                         -- form | widget | email | internal | crm | api | phone
  source_channel              TEXT,

  -- Contact
  contact_name                TEXT,
  contact_email               TEXT,
  contact_phone               TEXT,

  -- Service
  service_type                TEXT,
  appointment_type            TEXT,

  -- Scheduling
  requested_time              TIMESTAMPTZ,
  confirmed_time              TIMESTAMPTZ,
  end_time                    TIMESTAMPTZ,
  timezone                    TEXT DEFAULT 'UTC',
  duration_minutes            INTEGER DEFAULT 60,
  buffer_before_minutes       INTEGER DEFAULT 0,
  buffer_after_minutes        INTEGER DEFAULT 15,

  -- Assignment
  assigned_staff              TEXT,
  calendar_target             TEXT,
  location_or_link            TEXT,

  -- Status state machine
  -- pending | confirmed | pending_review | rescheduled | cancelled | no_show | completed | rejected | conflict
  status                      TEXT DEFAULT 'pending',
  urgency_level               TEXT DEFAULT 'normal',        -- low | normal | high | urgent

  -- Payloads
  raw_payload                 JSONB,
  normalized_payload          JSONB,
  scheduling_decision         JSONB DEFAULT '{}',

  -- Availability
  availability_checked        BOOLEAN DEFAULT FALSE,
  conflict_detected           BOOLEAN DEFAULT FALSE,
  auto_confirmed              BOOLEAN DEFAULT FALSE,

  -- Reminders (sequence stored for companion reminder cron workflow)
  reminder_sequence           JSONB DEFAULT '[]',

  -- AI
  intent_detected             TEXT,
  ai_model_used               TEXT,
  ai_model_source             TEXT,
  ai_response_time_ms         INTEGER DEFAULT 0,
  ai_fallback_used            BOOLEAN DEFAULT FALSE,

  -- Reschedule / cancel
  previous_appointment_id     TEXT,
  cancel_reason               TEXT,

  -- Validation
  validation_passed           BOOLEAN,
  validation_errors           JSONB DEFAULT '[]',

  -- Notes & error
  notes                       TEXT,
  error_message               TEXT,

  -- Timestamps
  received_at                 TIMESTAMPTZ,
  processed_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_appt_client        ON appointment_log (client_id);
CREATE INDEX IF NOT EXISTS idx_appt_status        ON appointment_log (status);
CREATE INDEX IF NOT EXISTS idx_appt_time          ON appointment_log (confirmed_time DESC);
CREATE INDEX IF NOT EXISTS idx_appt_staff         ON appointment_log (assigned_staff);
CREATE INDEX IF NOT EXISTS idx_appt_email         ON appointment_log (contact_email);
CREATE INDEX IF NOT EXISTS idx_appt_upcoming      ON appointment_log (confirmed_time)
  WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_appt_reminders     ON appointment_log (confirmed_time)
  WHERE status = 'confirmed' AND reminder_sequence != '[]'::jsonb;
