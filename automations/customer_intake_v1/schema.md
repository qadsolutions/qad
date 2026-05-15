# Customer Intake & Qualification — Input/Output Schema

## Input Schema
Received via webhook (POST /webhook/customer-intake)

```json
{
  "first_name": "string (required)",
  "last_name": "string (required)",
  "email": "string (required, valid email)",
  "phone": "string (optional)",
  "company_name": "string (optional)",
  "industry": "string (required)",
  "business_description": "string (required, max 1000 chars)",
  "pain_points": "string (required, max 1000 chars)",
  "monthly_budget": "number (required, USD)",
  "timeline": "string (required) — enum: immediate | 1_3_months | 3_6_months | 6_plus_months",
  "referral_source": "string (optional)"
}
```

## Output Schema
Written to PostgreSQL `leads` table and returned as webhook response.

```json
{
  "execution_id": "uuid",
  "client_id": "uuid",
  "qualification_score": "number (0–100)",
  "qualification_tier": "string — enum: hot | warm | cold | disqualified",
  "ai_summary": "string — 2–3 sentence qualification summary",
  "recommended_action": "string — enum: schedule_call | send_info_packet | add_to_nurture | do_not_pursue",
  "flags": ["string"] ,
  "status": "string — enum: success | error",
  "processed_at": "ISO 8601 timestamp"
}
```

## Qualification Scoring Logic (AI-evaluated)
| Criterion | Max Points |
|---|---|
| Budget fit (≥ $1,000/mo = full points) | 30 |
| Timeline urgency (immediate = full points) | 25 |
| Problem clarity and specificity | 25 |
| Industry fit | 20 |

## Tier Thresholds
| Score | Tier | Action |
|---|---|---|
| 80–100 | Hot | Schedule call |
| 50–79 | Warm | Send info packet |
| 25–49 | Cold | Add to nurture |
| 0–24 | Disqualified | Do not pursue |
