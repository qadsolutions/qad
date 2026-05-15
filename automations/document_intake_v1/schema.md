# Document Intake & Processing Agent v1 — Input/Output Schema

## Input Schema
Received via webhook (POST /webhook/document-intake)

```json
{
  "client_id": "string (optional, defaults to 'default')",
  "source_type": "string (optional) — enum: email | upload | webhook | folder",
  "sender": "string (optional) — email address or system name",
  "subject": "string (optional) — email subject or upload label",
  "file_name": "string (required)",
  "file_type": "string (optional) — pdf | png | jpg | tiff | docx | txt",
  "mime_type": "string (optional)",
  "file_size": "number (optional, bytes)",
  "file_content_base64": "string (optional) — base64 encoded file content",
  "document_text": "string (optional) — pre-extracted text if available",
  "document_class_hint": "string (optional) — hint from upstream system",
  "metadata": "object (optional) — any additional key/value pairs"
}
```

## Output Schema
Written to PostgreSQL `document_log` table and returned as webhook response.

```json
{
  "status": "success | error",
  "document_id": "string (doc_<timestamp>_<random>)",
  "classification_label": "string — e.g. invoice | contract | referral | intake_form | receipt | unknown",
  "confidence_score": "number (0–1)",
  "routing_destination": "string — e.g. accounts_payable | legal_review | patient_intake | human_review_queue",
  "filing_target": "string — e.g. invoice/2024/05",
  "extracted_fields": "object — type-specific fields (see Extracted Fields by Type below)",
  "downstream_action": "string — enum: auto_process | human_review | escalate | archive",
  "review_required": "boolean",
  "processing_status": "string — enum: success | pending_review | failed",
  "ai_fallback_used": "boolean",
  "processed_at": "ISO 8601 timestamp"
}
```

## Supported Document Classes
| Label | Examples |
|---|---|
| `invoice` | Vendor invoices, bills, statements |
| `contract` | Agreements, NDAs, service contracts |
| `intake_form` | Patient forms, client intake packets |
| `referral` | Medical referrals, case referrals |
| `receipt` | Purchase receipts, expense reports |
| `court_document` | Filings, orders, motions |
| `id_document` | Licenses, passports, IDs |
| `tax_document` | W2, 1099, returns |
| `real_estate` | Purchase agreements, disclosures, escrow |
| `correspondence` | Letters, emails, memos |
| `unknown` | Unclassified — routes to human review |

## Routing Destinations by Document Class
| Label | Routing Destination |
|---|---|
| `invoice` | `accounts_payable` |
| `contract` | `legal_review` |
| `intake_form` | `client_services` |
| `referral` | `patient_intake` |
| `receipt` | `expense_management` |
| `court_document` | `legal_urgent` (auto-escalated) |
| `id_document` | `compliance` |
| `tax_document` | `finance_team` |
| `real_estate` | `transactions` |
| `correspondence` | `general_inbox` |
| `unknown` | `human_review_queue` |

## Classification Confidence Thresholds
| Confidence | Source | Action |
|---|---|---|
| 0.92 | Keyword + AI consensus | Auto-process |
| 0.75 | Keyword only (AI unavailable) | Human review |
| 0.65 | Keyword + AI disagreement | Human review + flag |
| 0.55 | AI only (no keyword match) | Human review |
| < 0.50 | Hint fallback or unclassified | Human review required |
| 0 | Unclassified | Human review required |

## Extracted Fields by Document Type
| Type | Fields Extracted |
|---|---|
| `invoice` | invoice_number, vendor_name, invoice_date, due_date, total_amount, currency, payment_terms |
| `referral` | patient_name, date_of_birth, referring_physician, npi, diagnosis_code, diagnosis_description, authorization_number, urgency |
| `contract` | contract_type, effective_date, governing_law, term |
| `receipt` | merchant_name, transaction_date, total_amount, currency, payment_method |
| `court_document` | case_number, court_name, filing_date, document_type |
| `tax_document` | form_type, tax_year, taxpayer_name |
| `real_estate` | property_address, purchase_price, closing_date |
| `id_document` | id_type, id_number, full_name, expiry_date |
| `correspondence` | document_date, subject |
| `intake_form` | client_name, contact_email, contact_phone, service_requested |

## Classification Architecture
The workflow uses a **hybrid keyword + AI** approach:
1. **Keyword rules** scan the document text, filename, and subject for deterministic signals
2. **Ollama (llama3.2)** classifies independently as a second opinion
3. **Consensus scoring** combines both: agreement → 0.92, keyword-only → 0.75, disagreement → 0.65, AI-only → 0.55
4. **Code-based regex extraction** pulls structured fields from matching document text
5. **Threshold enforcement** in code (not AI) determines final routing action
