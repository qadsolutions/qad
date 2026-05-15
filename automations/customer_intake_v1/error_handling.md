# Customer Intake & Qualification — Error Handling & Retry Rules

## Retry Policy
| Step | Max Retries | Backoff | On Final Failure |
|---|---|---|---|
| AI qualification API call | 3 | Exponential (2s, 4s, 8s) | Route to manual review queue |
| PostgreSQL write | 3 | Linear (2s each) | Alert ops, log to file fallback |
| Notification send | 2 | Linear (5s each) | Log failure, continue workflow |

## Error Categories

### Validation Errors (no retry)
- Missing required fields → return 400 with field-level error list
- Invalid email format → return 400
- Budget below $0 → return 400
- business_description or pain_points exceeds max length → return 400

### Transient Errors (retry with backoff)
- AI API timeout or 429 rate limit
- Database connection timeout
- Notification service unavailable

### Fatal Errors (no retry, escalate)
- AI API returns malformed response after all retries
- Database write fails after all retries
- Unexpected exception in workflow node

## Manual Override Path
If the AI qualification step fails all retries:
1. The lead is written to the `leads` table with `qualification_tier = pending_review`.
2. A Slack/email alert is sent to the ops team with the raw intake data.
3. The ops team manually scores and updates the record.
4. A webhook trigger re-runs the notification step once the record is updated.

## Failure Logging
All errors write to the `workflow_errors` table with:
- `execution_id`
- `workflow_id = customer_intake_v1`
- `error_type` (validation | transient | fatal)
- `error_message`
- `failed_at` timestamp
- `retry_count`
- `resolved` boolean (default false)
