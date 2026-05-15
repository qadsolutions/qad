# Appointment & Scheduling Automation v1

Handles inbound booking requests from any source (form, widget, email, CRM, phone) and routes them through intent classification, availability checking, and confirmation — all logged to PostgreSQL.

## Workflow ID
`muVXGTx7suWyjaiT`

## Webhook
```
POST http://localhost:5678/webhook/appointment
Content-Type: application/json
```

## What it does

1. **Normalize** — Parses any inbound payload (webhook body or raw JSON), computes `end_time = requested_time + duration + buffer_after`, applies service duration defaults.

2. **Classify Intent** — Keyword rules first: explicit `request_type` field wins (confidence 1.0); otherwise scans `notes`/`message` for cancel/reschedule/book/inquiry signals.

3. **Ollama Intent** — `llama3.2` provides a second opinion when keyword confidence < 0.85. Consensus adds 0.08 to confidence; AI override uses AI score.

4. **Route** — `book → validate → availability check → confirm/review/conflict`; `reschedule → check new slot → update`; `cancel → update`; `inquiry/fallback → log`.

5. **Validate** — Checks: `contact_email` required; `requested_time` required (except inquiry); booking must be 2+ hours out, within 90 days. Business hours violations are soft flags (queue for review), not hard rejections.

6. **Availability** — PostgreSQL `OVERLAPS` query on `(confirmed_time, end_time)` ranges within `client_id`. Scoped to `assigned_staff` when set.

7. **Auto-Confirm** — Trusted sources (`internal`, `crm`, `staff`) and high-confidence non-urgent bookings auto-confirm. Urgent requests always go to staff review.

8. **Email** — Confirmation/conflict/reschedule/cancel emails via Gmail (requires credential). Staff notification sent for review-queue items.

9. **Log** — Every request is logged to `appointment_log` via `ON CONFLICT DO UPDATE` (idempotent). Reminder sequence stored as JSONB for companion cron workflow.

## Node Architecture (34 nodes)

```
Webhook → Normalize → Classify Intent → Ollama Intent → Parse Intent → Router
                                                                          │
                         ┌──────────────────────────────────────────────┬─┴──────────────────┬────────────────────────┐
                        book                                        reschedule              cancel              inquiry/fallback
                         │                                              │                    │                       │
               Validate Booking                                  Build Reschedule      Build Cancel           Prepare Log Data
                    │       │                                           │                    │
              pass  │   fail│                                   Check New Slot        Apply Cancellation
                    │       └→ Validation Fail Response                │
              Check Avail.                                      Process Reschedule
                    │                                                   │
             Process Avail.                                      Apply Reschedule
                    │       │
              no conf. │  conflict
                    │       └→ Handle Conflict → Send Conflict Notice
              Build Decision
                    │       │
             auto-confirm  review
                    │       │
             Confirm Appt. Queue for Review
             Send Confirm. Notify Staff
                    │       │
                    └───────┘
                            │
                    Prepare Log Data → Log to PostgreSQL → Webhook Response
```

## Business Hours (configurable in Normalize node)
Mon–Thu: 08:00–18:00 UTC | Fri: 08:00–17:00 UTC | Sat: 09:00–13:00 UTC | Sun: closed

Outside-hours requests flag `outside_business_hours` and route to `pending_review`.

## Credentials Required
| Credential | Node | Purpose |
|---|---|---|
| `Postgres account` (ID: MMScP2tKEgzvhkYM) | Check Availability, Log to PostgreSQL, etc. | Read/write `appointment_log` |
| `Gmail account` (ID: bHMHyGqUtDInnHet) | Send Confirmation, Notify Staff, etc. | Outbound email |

## Database Setup
Run before first use:
```sql
-- automations/appointment_scheduling_v1/postgres_schema.sql
```

## Test Suite
```powershell
.\test_appointment_scheduling.ps1
```
14 test cases covering: standard booking, auto-confirm, conflict detection, outside hours, validation failures (email/time), reschedule, cancel, inquiry, urgent, empty body, Ollama fallback, Saturday, Sunday.

## Configuration
All business config lives in the **Normalize Appointment** code node:
```javascript
const CONFIG = {
  business_hours: { mon: { open: '08:00', close: '18:00' }, ... },
  service_durations: { consultation: 30, follow_up: 15, ... },
  buffer_after_minutes: 15,
  min_advance_hours: 2,
  max_advance_days: 90,
  auto_confirm_sources: ['internal', 'crm', 'staff'],
  urgent_review_required: true
};
```

## Reminder Sequence
Stored as JSONB in `appointment_log.reminder_sequence`. Companion cron workflow polls for entries with `sent: false` and `send_at <= NOW()`. Types: `24h_reminder`, `2h_reminder`, `follow_up`.
