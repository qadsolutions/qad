# Appointment & Scheduling Automation v1 — Input/Output Schema

## Input Schema
Received via webhook (POST /webhook/appointment)

```json
{
  "client_id": "string (optional, defaults to 'default')",
  "source_type": "string (optional) — enum: form | widget | email | internal | crm | api | phone | staff",
  "source_channel": "string (optional)",
  "request_type": "string (optional) — enum: book | reschedule | cancel | inquiry. Inferred if omitted.",
  "contact_name": "string (optional)",
  "contact_email": "string (required for book/reschedule/cancel)",
  "contact_phone": "string (optional)",
  "service_type": "string (optional) — e.g. consultation | follow_up | initial_visit | assessment | showing",
  "appointment_type": "string (optional) — free-form label",
  "requested_time": "string (required for book/reschedule, optional for inquiry) — ISO 8601",
  "timezone": "string (optional, defaults to UTC) — IANA tz e.g. America/Chicago",
  "duration_minutes": "number (optional) — overrides service-type default",
  "buffer_before_minutes": "number (optional, default 0)",
  "buffer_after_minutes": "number (optional, default 15)",
  "assigned_staff": "string (optional) — availability check scoped to this staff member when set",
  "calendar_target": "string (optional)",
  "location": "string (optional) — physical address or meeting link",
  "urgency_level": "string (optional, default 'normal') — enum: low | normal | high | urgent",
  "notes": "string (optional) — free text, also parsed for intent signals",
  "message": "string (optional) — alias for notes",
  "previous_appointment_id": "string (required for reschedule/cancel)",
  "cancel_reason": "string (optional) — stored for cancel requests",
  "metadata": "object (optional)"
}
```

## Output Schema
Returned as webhook response and written to PostgreSQL `appointment_log`.

```json
{
  "appointment_id": "string (appt_<timestamp>_<random>)",
  "status": "confirmed | pending_review | conflict | rescheduled | cancelled | error",
  "service_type": "string",
  "contact_email": "string",
  "processed_at": "ISO 8601 timestamp",

  "confirmed_time": "ISO 8601 (present when status=confirmed or pending_review)",
  "duration_minutes": "number (present when confirmed)",
  "location_or_link": "string or null (present when confirmed)",
  "requested_time": "ISO 8601 (present when pending_review or conflict)",
  "alternatives": "array of {offset, time} (present when conflict)",
  "message": "human-readable summary"
}
```

Error response (HTTP 400):
```json
{
  "status": "error",
  "error_type": "validation",
  "errors": ["array of error strings"],
  "appointment_id": "string"
}
```

## Service Duration Defaults
| Service Type | Duration (min) |
|---|---|
| `consultation` | 30 |
| `follow_up` | 15 |
| `initial_visit` | 60 |
| `assessment` | 90 |
| `showing` | 45 |
| `checkup` | 30 |
| `default` | 60 |

Buffer: 15 minutes after every appointment by default.

## Business Hours (Configurable in Normalize Appointment node)
| Day | Open (UTC) | Close (UTC) |
|---|---|---|
| Mon–Thu | 08:00 | 18:00 |
| Fri | 08:00 | 17:00 |
| Sat | 09:00 | 13:00 |
| Sun | Closed | — |

Requests outside business hours are flagged (`outside_business_hours`) and routed to `pending_review` — they are not rejected.

## Status State Machine
```
pending → confirmed | pending_review | conflict | rejected
pending_review → confirmed | cancelled (via staff action)
confirmed → rescheduled | cancelled | no_show | completed
```

## Intent Classification
1. **Explicit `request_type`** → used directly (confidence 1.0)
2. **Keyword scan** of `notes`, `message`, `service_type`, `appointment_type`:
   - cancel/reschedule/book/inquiry keywords map to intent with 0.80–0.90 confidence
3. **Ollama (llama3.2)** provides second opinion when keyword confidence < 0.85
4. **Final fallback**: `book` if `requested_time` is set, otherwise `inquiry`

## Auto-Confirm Logic
Appointments auto-confirm when:
- `source_type` is `internal`, `crm`, or `staff` — trusted sources bypass review
- `intent_confidence >= 0.90` AND `urgency_level != 'urgent'`

Appointments always route to `pending_review` when:
- `urgency_level = 'urgent'` (staff review always required)
- Request is outside business hours
- Confidence is below threshold

## Conflict Detection
Uses PostgreSQL `OVERLAPS` on `(confirmed_time, end_time)` ranges within the same `client_id`. When `assigned_staff` is set, conflict check is scoped to that staff member. Status `conflict` is returned with 4 alternative time suggestions.

## Reminder Sequence
Stored as JSONB in `reminder_sequence`:
- `confirmation` — sent at booking time
- `24h_reminder` — send_at = confirmed_time minus 24h (if > 24h away)
- `2h_reminder` — send_at = confirmed_time minus 2h (if > 2h away)
- `follow_up` — send_at = confirmed_time plus 2h

A companion cron workflow processes `reminder_sequence` entries with `sent: false`.
