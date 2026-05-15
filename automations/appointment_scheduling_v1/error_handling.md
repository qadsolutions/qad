# Appointment & Scheduling v1 — Error Handling

## Validation Errors (HTTP 400)
| Condition | Error Message |
|---|---|
| Missing `contact_email` | `contact_email is required` |
| Missing `requested_time` (non-inquiry) | `requested_time is required — format: ISO 8601 e.g. 2026-05-15T14:00:00Z` |
| Too soon | `Must book at least 2 hours in advance` |
| Too far out | `Cannot book more than 90 days out` |

Response: `{ status: "error", error_type: "validation", errors: [...], appointment_id: "..." }`
Logged to `appointment_log` with `status = 'rejected'`.

## Soft Flags (not rejected — routes to pending_review)
| Condition | Flag |
|---|---|
| Request time before business hours open | `outside_business_hours` |
| Request time after business hours close | `outside_business_hours` |
| Request on a closed day (Sun) | `outside_business_hours` |
| `urgency_level = urgent` | `urgent_request`, `urgent_staff_review` |

These produce `status: "pending_review"` — a human confirms or declines.

## Conflict Detection
When `(confirmed_time, end_time) OVERLAPS (requested_time, end_time)` for same `client_id`:
- Response: `status: "conflict"` with `alternatives` array (4 suggested slots)
- Email sent to contact with alternatives
- Logged with `conflict_detected = true`

## AI (Ollama) Failure
- `continueOnFail: true` on the Ollama HTTP Request node
- Parse Ollama Intent detects error/missing response, sets `ai_fallback_used = true`
- Intent falls back to keyword classification result
- If keyword also failed: defaults to `book` (time present) or `inquiry` (no time)
- Workflow continues normally — AI failure is not fatal

## PostgreSQL Failure
- `continueOnFail: true` on all Postgres nodes
- Logging failure does not block the webhook response
- Availability check failure: treated as no-conflict (optimistic proceed)

## Email Failure
- `continueOnFail: true` on all Gmail nodes
- Email failure is logged as a workflow-level note but does not fail the booking
- Contact gets the webhook response regardless

## Retries
No automatic retry at the workflow level. n8n execution logs capture all failures. Downstream systems can re-POST using the same `appointment_id` (idempotent — `ON CONFLICT DO UPDATE`).

## Error Handler Node
An `Error Trigger` node captures fatal workflow errors and logs to `workflow_errors` table (created in data spine phase).
