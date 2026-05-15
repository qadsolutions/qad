# Customer Intake & Qualification v1

**Workflow ID:** `4aPludoDhXMyAk7x`  
**Webhook URL:** `http://localhost:5678/webhook/customer-intake`  
**Version:** 1.0  
**Status:** Deployed (inactive — requires credentials before activation)

---

## Purpose

Captures inbound leads from any source, normalizes them into a canonical structure, scores and classifies them using configurable rules and local AI (Ollama), routes them to the right destination, and logs every step to PostgreSQL. Designed to work across industries without modification.

---

## Supported Input Sources

| Source | Detection Method |
|---|---|
| Website form | `form_id` in payload |
| Email parsed lead | `email_id` in payload |
| Site chat lead | `chat_session_id` in payload |
| CRM webhook | `crm_event` in payload |
| Manual entry | `manual_entry: true` |
| Generic webhook | default |

All sources normalize to the same canonical intake object before processing.

---

## Workflow Layers

```
Webhook → Normalize → Validate → [Ollama Classification] → Score → Route → Log → Respond
                         ↓ fail
                    400 Response + Error Log
```

### 1. Trigger
- POST `http://localhost:5678/webhook/customer-intake`
- Responds via `Respond to Webhook` node (not immediately)

### 2. Normalize Intake
Converts any payload shape into the canonical intake object. Handles field aliases across CRMs, forms, and email parsers.

### 3. Validate & Deduplicate
- Checks required fields (email or phone, message body)
- Validates email format
- Detects spam keywords
- Flags suspected duplicates
- Invalid submissions exit here with a 400 response

### 4. Ollama Classification (local AI)
- Calls `http://localhost:11434/api/generate` with `llama3.2`
- Classifies intent: `buying | exploring | support | spam | unclear`
- Returns urgency, confidence score, summary, and flags
- **If Ollama is unavailable or returns malformed JSON:** falls back to `human_review` path — never blocks intake

### 5. Qualification Scoring
Rules-first engine (0–100):
| Criterion | Max Points |
|---|---|
| Monthly budget | 30 |
| Timeline urgency | 25 |
| Message quality/length | 25 |
| Industry fit | 20 |

AI overlay: buying intent +10, spam = 0, unclear/fallback −5, high urgency +5.

| Score | Tier | Action |
|---|---|---|
| 80–100 | `hot` | `schedule_call` |
| 50–79 | `warm` | `send_info_packet` |
| 25–49 | `cold` | `add_to_nurture` |
| 0–24 | `disqualified` | `do_not_pursue` |
| any (AI fail) | `pending_review` | `human_review` |

### 6. Routing
Switch node routes by tier:
- **Hot** → Email alert to sales team
- **Warm** → Acknowledgement email to the lead
- **Cold** → Enqueued for nurture sequence
- **Pending Review** → Email alert to ops team
- **Disqualified** → Logged only, no outreach

All paths converge before PostgreSQL logging.

### 7. PostgreSQL Logging
Writes a full record to `intake_log` including raw payload, normalized object, classification result, scores, routing decision, and AI metadata. Uses `ON CONFLICT (intake_id) DO NOTHING` for dedup safety.

### 8. Webhook Response
Returns structured JSON to the caller:
```json
{
  "status": "success",
  "intake_id": "intake_1234567890_abc123",
  "qualification_tier": "warm",
  "qualification_score": 63,
  "recommended_action": "send_info_packet",
  "human_review_needed": false,
  "flags": ["no_company_name"],
  "processed_at": "2026-05-09T03:30:00.000Z"
}
```

---

## Configuration

### Email addresses to update before activation
In n8n, update these nodes with real addresses:
- **Hot Lead — Alert Ops:** `fromEmail`, `toEmail` (your sales team)
- **Warm Lead — Send Info Packet:** `fromEmail`
- **Pending Review — Alert Ops:** `fromEmail`, `toEmail` (your ops team)

### Ollama model
The model is set to `llama3.2` in **Ollama Classification** node. Change `model` in the request body to use a different local model.

### Scoring thresholds
Edit the **Qualification Scoring** code node to adjust:
- Budget breakpoints
- Industry fit lists (`highFit`, `medFit` arrays)
- Tier score boundaries

### Industry fit lists
In **Qualification Scoring**, update `highFit` and `medFit` arrays to match the client's target verticals.

---

## Error Handling

| Failure | Behavior |
|---|---|
| Validation error | 400 response + logged to `intake_log` |
| Ollama unavailable | Fallback to `pending_review`, never blocks intake |
| Ollama malformed JSON | Same fallback |
| Ollama low confidence (<0.5) | Flags `low_ai_confidence`, routes to `pending_review` |
| PostgreSQL write fails | `continueOnFail` — workflow continues, error surfaced in execution log |
| Fatal workflow error | `Error Handler` node catches and writes to `workflow_errors` table |
| Email send fails | `continueOnFail` — logged in n8n, does not block response |

---

## Database Setup

Run `postgres_schema.sql` before activating the workflow:
```sql
psql -U youruser -d yourdb -f postgres_schema.sql
```

Requires two tables: `intake_log` and `workflow_errors`.

---

## Credentials Required

Before activating, configure in n8n Settings → Credentials:
1. **PostgreSQL Main** (`postgres_main`) — connection to your Postgres instance
2. **SMTP / Email** — for the email notification nodes

---

## Test Fixtures

See `test_fixtures.json` for 5 test cases covering:
- Hot lead (high budget, immediate timeline)
- Warm lead (moderate budget, 1–3 months)
- Disqualified lead (low budget, vague message)
- Validation error (bad email format)
- Manual review path (AI failure simulation)

### Quick test (hot lead)
```bash
curl -X POST http://localhost:5678/webhook/customer-intake \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Sarah",
    "last_name": "Chen",
    "email": "sarah.chen@techcorp.com",
    "company_name": "TechCorp Solutions",
    "industry": "SaaS",
    "business_description": "We build B2B project management software with 200 active clients.",
    "pain_points": "Our onboarding takes 3 weeks manually. We need it automated to under 48 hours.",
    "monthly_budget": 5000,
    "timeline": "immediate"
  }'
```

### Quick test (validation error)
```bash
curl -X POST http://localhost:5678/webhook/customer-intake \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Test",
    "email": "not-a-valid-email",
    "industry": "Healthcare",
    "pain_points": "Test"
  }'
```

---

## Customizing for a New Client

1. Update `client_id` in intake payloads or set a default in the **Normalize Intake** node.
2. Adjust `highFit`/`medFit` industry arrays in **Qualification Scoring**.
3. Update email addresses in notification nodes.
4. Change the Ollama model if needed.
5. Add client-specific routing rules to the **Route by Tier** switch node.
6. No structural changes to the workflow are required.
