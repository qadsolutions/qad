const http = require('http');

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1N2FhMTMyNS1mODM2LTRmOGItYTk2NC02NDA4NjJlMTQxZjYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNzNlMmRjMTgtMzU5MS00ZjljLWIyYjYtMzZhZjdlNjYwYzViIiwiaWF0IjoxNzc4Mjk1NDUxLCJleHAiOjE3ODA4MTU2MDB9.X7T72Ph9Hv1qY_I8bGB2KnFtmdJ18wVdk6rDiwSjJ9U';
const OLD_WF_ID = 'O1e31Q9dMP4I86Lr';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: 'localhost', port: 5678, path, method,
      headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    }, res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve(JSON.parse(c.join('')))); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

const $ = String.fromCharCode(36);

// ─── Node Code: Normalize Document ─────────────────────────────────────────
const NORMALIZE_CODE = `
const raw = ${$}input.first().json.body || ${$}input.first().json;
const now = new Date().toISOString();
const documentId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
const executionId = ${$}execution?.id || 'exec_' + Date.now();

const sourceType = raw.source_type || (raw.sender ? 'email' : raw.upload_session ? 'upload' : 'webhook');
const rawFileName = raw.file_name || null;
const rawFileType = raw.file_type || (rawFileName ? rawFileName.split('.').pop().toLowerCase() : null);

const doc = {
  document_id: documentId,
  execution_id: executionId,
  workflow_version: 'document_intake_v1',
  client_id: raw.client_id || 'default',
  source_type: sourceType,
  source_channel: raw.source_channel || null,
  sender: raw.sender || null,
  subject: raw.subject || null,
  file_name: rawFileName,
  file_type: rawFileType,
  mime_type: raw.mime_type || null,
  file_size: raw.file_size || null,
  file_content_base64: raw.file_content_base64 || null,
  document_text: raw.document_text || null,
  document_class_hint: raw.document_class_hint || null,
  metadata: raw.metadata || {},
  received_at: now,
  processed_at: null,
  validation_passed: null,
  validation_errors: [],
  classification_label: null,
  confidence_score: 0,
  extracted_fields: {},
  routing_destination: null,
  filing_target: null,
  downstream_action: null,
  review_required: false,
  processing_status: 'processing',
  ai_model_used: null,
  ai_model_source: null,
  ai_response_time_ms: 0,
  ai_fallback_used: false,
  error_message: null,
  flags: []
};

return [{ json: { doc, raw_payload: raw } }];
`.trim();

// ─── Node Code: Validate Document ──────────────────────────────────────────
const VALIDATE_CODE = `
const data = ${$}input.first().json;
const doc = { ...data.doc };
doc.flags = Array.isArray(doc.flags) ? [...doc.flags] : [];
const errors = [];

if (!doc.file_name) errors.push('file_name is required');

const allowedTypes = ['pdf','png','jpg','jpeg','tiff','tif','docx','doc','txt','heic','xlsx','csv'];
if (doc.file_type && !allowedTypes.includes(doc.file_type.toLowerCase())) {
  errors.push('Unsupported file type: ' + doc.file_type);
}
if (doc.file_size && doc.file_size > 52428800) {
  errors.push('File exceeds 50MB limit');
}
if (!doc.document_text && !doc.file_content_base64) {
  doc.flags.push('no_content_provided');
  doc.flags.push('content_missing_may_need_ocr');
}
if (doc.document_text && doc.document_text.trim().length < 10) {
  doc.flags.push('very_short_text');
}

if (errors.length > 0) {
  doc.validation_passed = false;
  doc.validation_errors = errors;
  doc.processing_status = 'failed';
  doc.downstream_action = 'reject';
} else {
  doc.validation_passed = true;
}

return [{ json: { doc, raw_payload: data.raw_payload } }];
`.trim();

// ─── Node Code: Extract Text ────────────────────────────────────────────────
const EXTRACT_TEXT_CODE = `
const data = ${$}input.first().json;
const doc = { ...data.doc };
doc.flags = Array.isArray(doc.flags) ? [...doc.flags] : [];

if (doc.document_text && doc.document_text.trim().length > 10) {
  doc.flags.push('text_provided_directly');
  return [{ json: { doc, raw_payload: data.raw_payload } }];
}

if (doc.file_content_base64) {
  try {
    const decoded = Buffer.from(doc.file_content_base64, 'base64').toString('utf-8');
    const printable = decoded.replace(/[\\x00-\\x08\\x0e-\\x1f\\x7f-\\x9f]/g, '');
    const ratio = printable.length / Math.max(decoded.length, 1);
    if (ratio > 0.85 && printable.length > 20) {
      doc.document_text = printable.substring(0, 8000);
      doc.flags.push('text_extracted_from_content');
    } else {
      doc.flags.push('binary_content_ocr_needed');
      doc.document_text = '[Binary content — OCR required]';
    }
  } catch(e) {
    doc.flags.push('text_extraction_failed');
    doc.document_text = '[Text extraction failed]';
  }
} else {
  doc.document_text = '[No content — classification from metadata only]';
  doc.flags.push('metadata_only_classification');
}

return [{ json: { doc, raw_payload: data.raw_payload } }];
`.trim();

// ─── Ollama Body (template mode — no leading = so {{ }} vars are evaluated) ─
const OLLAMA_BODY = `{
  "model": "llama3.2",
  "prompt": "You are a document classification and data extraction AI for a general business document management system. Analyze the document below and return ONLY a valid JSON object — no markdown, no explanation, no code fences.\\n\\nDOCUMENT METADATA:\\nFilename: {{ ${$}json.doc.file_name }}\\nFile Type: {{ ${$}json.doc.file_type }}\\nSender: {{ ${$}json.doc.sender }}\\nSubject: {{ ${$}json.doc.subject }}\\nUpstream Hint: {{ ${$}json.doc.document_class_hint || 'none' }}\\n\\nDOCUMENT TEXT (first 3000 chars):\\n{{ (${$}json.doc.document_text || '[No text available]').substring(0, 3000) }}\\n\\nCLASSIFICATION LABELS (pick exactly one):\\ninvoice, contract, intake_form, referral, receipt, court_document, id_document, tax_document, real_estate, correspondence, unknown\\n\\nEXTRACTION SCHEMAS BY TYPE:\\n- invoice: vendor_name, invoice_number, invoice_date, due_date, total_amount, currency, payment_terms, line_items_count, po_number\\n- contract: party_a, party_b, effective_date, termination_date, contract_type, governing_law, key_obligations\\n- intake_form: client_name, date_of_birth, contact_email, contact_phone, service_requested, referring_source\\n- referral: patient_name, date_of_birth, referring_physician, npi, diagnosis_code, diagnosis_description, referral_to, authorization_number, urgency\\n- receipt: merchant_name, transaction_date, total_amount, currency, payment_method, item_count\\n- court_document: case_number, court_name, filing_date, document_type, parties, judge_name\\n- id_document: full_name, id_number, id_type, issue_date, expiry_date, issuing_authority\\n- tax_document: taxpayer_name, tax_year, form_type, gross_income, tax_liability, filing_status\\n- real_estate: property_address, buyer_name, seller_name, purchase_price, closing_date, property_type\\n- correspondence: sender_name, recipient_name, document_date, subject, action_required, response_deadline\\n\\nReturn this exact JSON structure. Fill extracted_fields with only the fields relevant to the classified document type. Use null for any field you cannot determine:\\n{\\n  \\"classification_label\\": \\"invoice\\",\\n  \\"confidence\\": 0.92,\\n  \\"routing_destination\\": \\"accounts_payable\\",\\n  \\"filing_target\\": \\"invoices/vendors/2024\\",\\n  \\"extracted_fields\\": {},\\n  \\"summary\\": \\"One sentence describing this document and its key data points.\\",\\n  \\"urgency\\": \\"normal\\",\\n  \\"flags\\": []\\n}\\n\\nRouting destination options by type: invoice=accounts_payable, contract=legal_review, intake_form=client_services, referral=patient_intake, receipt=expense_management, court_document=legal_urgent, id_document=compliance, tax_document=finance_team, real_estate=transactions, correspondence=general_inbox, unknown=human_review_queue",
  "stream": false,
  "format": "json"
}`;

// ─── Node Code: Parse & Route ───────────────────────────────────────────────
const PARSE_OLLAMA_CODE = [
  `const ollamaData = ${$}input.first().json;`,
  `const prevData = ${$}('Validation Gate').first().json;`,
  `const doc = { ...prevData.doc };`,
  `doc.flags = Array.isArray(doc.flags) ? [...doc.flags] : [];`,
  ``,
  `// Merge in text extraction results`,
  `try {`,
  `  const extracted = ${$}('Extract Text').first().json;`,
  `  if (extracted && extracted.doc) {`,
  `    doc.document_text = extracted.doc.document_text || doc.document_text;`,
  `    doc.flags = [...new Set([...doc.flags, ...(extracted.doc.flags || [])])];`,
  `  }`,
  `} catch(e) {}`,
  ``,
  `const VALID_LABELS = ['invoice','contract','intake_form','referral','receipt','court_document','id_document','tax_document','real_estate','correspondence','unknown'];`,
  ``,
  `// Default routing destinations per document type`,
  `const ROUTING_MAP = {`,
  `  invoice: 'accounts_payable',`,
  `  contract: 'legal_review',`,
  `  intake_form: 'client_services',`,
  `  referral: 'patient_intake',`,
  `  receipt: 'expense_management',`,
  `  court_document: 'legal_urgent',`,
  `  id_document: 'compliance',`,
  `  tax_document: 'finance_team',`,
  `  real_estate: 'transactions',`,
  `  correspondence: 'general_inbox',`,
  `  unknown: 'human_review_queue'`,
  `};`,
  ``,
  `const ollamaRaw = ollamaData.response || null;`,
  `let label = 'unknown';`,
  `let confidence = 0;`,
  `let extractedFields = {};`,
  `let routingDestination = 'human_review_queue';`,
  `let filingTarget = 'unclassified/pending';`,
  `let summary = '';`,
  `let urgency = 'normal';`,
  `let aiSuccess = false;`,
  ``,
  `try {`,
  `  if (!ollamaRaw || ollamaData.error) throw new Error('Ollama unavailable: ' + (ollamaData.error || 'no response'));`,
  ``,
  `  const parsed = typeof ollamaRaw === 'string' ? JSON.parse(ollamaRaw) : ollamaRaw;`,
  `  const rawLabel = (parsed.classification_label || '').toLowerCase().trim();`,
  `  const rawConf = parsed.confidence;`,
  ``,
  `  label = VALID_LABELS.includes(rawLabel) ? rawLabel : 'unknown';`,
  `  confidence = typeof rawConf === 'number' ? rawConf : (parseFloat(rawConf) || 0);`,
  `  confidence = Math.min(1, Math.max(0, confidence));`,
  `  extractedFields = parsed.extracted_fields || {};`,
  `  summary = parsed.summary || '';`,
  `  urgency = parsed.urgency || 'normal';`,
  ``,
  `  // Use AI-suggested routing if valid, else fall back to our map`,
  `  routingDestination = parsed.routing_destination || ROUTING_MAP[label] || 'human_review_queue';`,
  `  filingTarget = parsed.filing_target || (label + '/general');`,
  ``,
  `  doc.ai_model_used = 'llama3.2';`,
  `  doc.ai_model_source = 'ollama_local';`,
  `  doc.ai_fallback_used = false;`,
  `  aiSuccess = true;`,
  `} catch(e) {`,
  `  // AI failed — use hint if available`,
  `  const hint = (doc.document_class_hint || '').toLowerCase();`,
  `  if (VALID_LABELS.includes(hint)) {`,
  `    label = hint;`,
  `    routingDestination = ROUTING_MAP[hint];`,
  `    filingTarget = hint + '/unverified';`,
  `    summary = 'AI unavailable — classified from upstream hint: ' + hint;`,
  `    doc.flags.push('hint_used_ai_unavailable');`,
  `  } else {`,
  `    summary = 'AI classification failed — routed to human review.';`,
  `  }`,
  `  doc.ai_model_used = null;`,
  `  doc.ai_model_source = 'fallback';`,
  `  doc.ai_fallback_used = true;`,
  `  doc.flags.push('ai_fallback_triggered');`,
  `}`,
  ``,
  `// ── Enforce confidence thresholds regardless of AI output ──────────────`,
  `// Spec: >=0.80 auto_process | 0.50–0.79 review flag | <0.50 human review`,
  `let downstreamAction;`,
  `let reviewRequired = false;`,
  ``,
  `if (!aiSuccess) {`,
  `  downstreamAction = 'human_review';`,
  `  reviewRequired = true;`,
  `} else if (label === 'unknown' || confidence < 0.50) {`,
  `  downstreamAction = 'human_review';`,
  `  reviewRequired = true;`,
  `  doc.flags.push('low_confidence_review');`,
  `} else if (confidence < 0.80) {`,
  `  downstreamAction = 'human_review';`,
  `  reviewRequired = true;`,
  `  doc.flags.push('moderate_confidence_review');`,
  `} else {`,
  `  downstreamAction = 'auto_process';`,
  `}`,
  ``,
  `// Escalate court docs and urgent referrals regardless of confidence`,
  `if ((label === 'court_document' || urgency === 'urgent') && aiSuccess) {`,
  `  downstreamAction = 'escalate';`,
  `  reviewRequired = true;`,
  `  doc.flags.push('auto_escalated');`,
  `}`,
  ``,
  `doc.classification_label = label;`,
  `doc.confidence_score = confidence;`,
  `doc.routing_destination = routingDestination;`,
  `doc.filing_target = filingTarget;`,
  `doc.downstream_action = downstreamAction;`,
  `doc.review_required = reviewRequired;`,
  `doc.extracted_fields = extractedFields;`,
  `doc.classification_result = { label, confidence, routing_destination: routingDestination, filing_target: filingTarget, extracted_fields: extractedFields, summary, urgency, ai_success: aiSuccess };`,
  `doc.processed_at = new Date().toISOString();`,
  ``,
  `return [{ json: { doc, raw_payload: prevData.raw_payload } }];`
].join('\n');

// ─── Node Code: Auto Process Document ──────────────────────────────────────
const AUTO_PROCESS_CODE = `
const doc = ${$}input.first().json.doc;
const raw = ${$}input.first().json.raw_payload;
// High-confidence auto-process: file it, mark ready for downstream system
const year = new Date().getFullYear();
const month = String(new Date().getMonth() + 1).padStart(2, '0');
const filedPath = (doc.filing_target || doc.classification_label + '/general') + '/' + year + '/' + month;
return [{ json: {
  doc: { ...doc, processing_status: 'success', filed_path: filedPath },
  raw_payload: raw,
  action_taken: 'auto_processed',
  filed_to: filedPath
} }];
`.trim();

// ─── Node Code: Archive Document ───────────────────────────────────────────
const ARCHIVE_CODE = `
const doc = ${$}input.first().json.doc;
const raw = ${$}input.first().json.raw_payload;
return [{ json: {
  doc: { ...doc, processing_status: 'success' },
  raw_payload: raw,
  action_taken: 'archived',
  filed_to: 'archive/' + (doc.classification_label || 'unknown') + '/' + new Date().getFullYear()
} }];
`.trim();

// ─── Node Code: Prepare Log Data ───────────────────────────────────────────
const PREP_LOG_CODE = [
  `const scored = ${$}('Parse & Route').first().json;`,
  `const doc = scored.doc || {};`,
  `const raw = scored.raw_payload || {};`,
  `const processingStatus = doc.processing_status === 'processing'`,
  `  ? (doc.review_required ? 'pending_review' : 'success')`,
  `  : (doc.processing_status || 'success');`,
  ``,
  `return [{`,
  `  json: {`,
  `    document_id: doc.document_id || 'unknown',`,
  `    execution_id: doc.execution_id || null,`,
  `    workflow_version: doc.workflow_version || 'document_intake_v1',`,
  `    client_id: doc.client_id || 'default',`,
  `    source_type: doc.source_type || null,`,
  `    source_channel: doc.source_channel || null,`,
  `    sender: doc.sender || null,`,
  `    subject: doc.subject || null,`,
  `    file_name: doc.file_name || null,`,
  `    file_type: doc.file_type || null,`,
  `    mime_type: doc.mime_type || null,`,
  `    file_size: doc.file_size || null,`,
  `    document_text: doc.document_text ? doc.document_text.substring(0, 5000) : null,`,
  `    raw_payload: JSON.stringify(raw),`,
  `    normalized_payload: JSON.stringify(doc),`,
  `    validation_passed: doc.validation_passed || false,`,
  `    validation_errors: JSON.stringify(doc.validation_errors || []),`,
  `    classification_label: doc.classification_label || null,`,
  `    confidence_score: doc.confidence_score || 0,`,
  `    classification_result: JSON.stringify(doc.classification_result || {}),`,
  `    extracted_fields: JSON.stringify(doc.extracted_fields || {}),`,
  `    filing_target: doc.filing_target || null,`,
  `    downstream_action: doc.downstream_action || null,`,
  `    review_required: doc.review_required || false,`,
  `    processing_status: processingStatus,`,
  `    ai_model_used: doc.ai_model_used || null,`,
  `    ai_model_source: doc.ai_model_source || 'none',`,
  `    ai_response_time_ms: doc.ai_response_time_ms || 0,`,
  `    ai_fallback_used: doc.ai_fallback_used || false,`,
  `    error_message: doc.error_message || null,`,
  `    received_at: doc.received_at || new Date().toISOString(),`,
  `    processed_at: doc.processed_at || new Date().toISOString()`,
  `  }`,
  `}];`
].join('\n');

// ─── PostgreSQL INSERT ──────────────────────────────────────────────────────
const LOG_SQL = `INSERT INTO document_log (
  document_id, execution_id, workflow_version, client_id,
  source_type, source_channel, sender, subject,
  file_name, file_type, mime_type, file_size,
  document_text, raw_payload, normalized_payload,
  validation_passed, validation_errors,
  classification_label, confidence_score, classification_result,
  extracted_fields, filing_target, downstream_action,
  review_required, processing_status,
  ai_model_used, ai_model_source, ai_response_time_ms, ai_fallback_used,
  error_message, received_at, processed_at
) VALUES (
  '{{ $json.document_id }}',
  {{ $json.execution_id ? "'" + $json.execution_id + "'" : 'NULL' }},
  '{{ $json.workflow_version }}',
  '{{ $json.client_id }}',
  {{ $json.source_type ? "'" + $json.source_type + "'" : 'NULL' }},
  {{ $json.source_channel ? "'" + $json.source_channel + "'" : 'NULL' }},
  {{ $json.sender ? "'" + $json.sender.replace(/'/g, "''") + "'" : 'NULL' }},
  {{ $json.subject ? "'" + $json.subject.replace(/'/g, "''") + "'" : 'NULL' }},
  {{ $json.file_name ? "'" + $json.file_name.replace(/'/g, "''") + "'" : 'NULL' }},
  {{ $json.file_type ? "'" + $json.file_type + "'" : 'NULL' }},
  {{ $json.mime_type ? "'" + $json.mime_type + "'" : 'NULL' }},
  {{ $json.file_size || 'NULL' }},
  {{ $json.document_text ? "'" + $json.document_text.replace(/'/g, "''") + "'" : 'NULL' }},
  '{{ $json.raw_payload.replace(/'/g, "''") }}'::jsonb,
  '{{ $json.normalized_payload.replace(/'/g, "''") }}'::jsonb,
  {{ $json.validation_passed }},
  '{{ $json.validation_errors }}'::jsonb,
  {{ $json.classification_label ? "'" + $json.classification_label + "'" : 'NULL' }},
  {{ $json.confidence_score || 0 }},
  '{{ $json.classification_result.replace(/'/g, "''") }}'::jsonb,
  '{{ $json.extracted_fields.replace(/'/g, "''") }}'::jsonb,
  {{ $json.filing_target ? "'" + $json.filing_target.replace(/'/g, "''") + "'" : 'NULL' }},
  {{ $json.downstream_action ? "'" + $json.downstream_action + "'" : 'NULL' }},
  {{ $json.review_required }},
  {{ $json.processing_status ? "'" + $json.processing_status + "'" : 'NULL' }},
  {{ $json.ai_model_used ? "'" + $json.ai_model_used + "'" : 'NULL' }},
  '{{ $json.ai_model_source }}',
  {{ $json.ai_response_time_ms || 0 }},
  {{ $json.ai_fallback_used }},
  {{ $json.error_message ? "'" + $json.error_message.replace(/'/g, "''") + "'" : 'NULL' }},
  '{{ $json.received_at }}',
  '{{ $json.processed_at }}'
)
ON CONFLICT (document_id) DO NOTHING
RETURNING document_id, classification_label, downstream_action;`;

// ─── Workflow Definition ────────────────────────────────────────────────────
const workflow = {
  name: "Document Intake & Processing Agent v1",
  nodes: [
    // Entry
    {
      id: "node_webhook", name: "Document Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 300],
      parameters: { httpMethod: "POST", path: "document-intake", responseMode: "responseNode", options: {} }
    },
    // Normalize
    {
      id: "node_normalize", name: "Normalize Document", type: "n8n-nodes-base.code", typeVersion: 2, position: [220, 300],
      parameters: { jsCode: NORMALIZE_CODE }
    },
    // Validate
    {
      id: "node_validate", name: "Validate Document", type: "n8n-nodes-base.code", typeVersion: 2, position: [440, 300],
      parameters: { jsCode: VALIDATE_CODE }
    },
    // Validation Gate (IF: validation_passed = true)
    {
      id: "node_validation_gate", name: "Validation Gate", type: "n8n-nodes-base.if", typeVersion: 2, position: [660, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
          conditions: [{ leftValue: `={{ ${$}json.doc.validation_passed }}`, rightValue: true, operator: { type: "boolean", operation: "equals" } }],
          combinator: "and"
        }
      }
    },
    // Extract text from base64 or pass through
    {
      id: "node_extract_text", name: "Extract Text", type: "n8n-nodes-base.code", typeVersion: 2, position: [880, 180],
      parameters: { jsCode: EXTRACT_TEXT_CODE }
    },
    // Ollama: classify + extract fields
    {
      id: "node_ollama", name: "Ollama Classify & Extract", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [1100, 180],
      parameters: {
        method: "POST",
        url: "http://host.docker.internal:11434/api/generate",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
        sendBody: true, contentType: "raw", rawContentType: "application/json",
        body: OLLAMA_BODY,
        options: { timeout: 60000 }
      },
      continueOnFail: true
    },
    // Parse AI response, enforce thresholds, set routing
    {
      id: "node_parse", name: "Parse & Route", type: "n8n-nodes-base.code", typeVersion: 2, position: [1320, 180],
      parameters: { jsCode: PARSE_OLLAMA_CODE }
    },
    // Route by downstream_action
    {
      id: "node_route", name: "Route by Action", type: "n8n-nodes-base.switch", typeVersion: 3, position: [1540, 180],
      parameters: {
        mode: "rules",
        rules: {
          values: [
            {
              conditions: { options: { caseSensitive: false, leftValue: "", typeValidation: "loose" }, conditions: [{ leftValue: `={{ ${$}json.doc.downstream_action }}`, rightValue: "auto_process", operator: { type: "string", operation: "equals" } }], combinator: "and" },
              renameOutput: true, outputKey: "auto_process"
            },
            {
              conditions: { options: { caseSensitive: false, leftValue: "", typeValidation: "loose" }, conditions: [{ leftValue: `={{ ${$}json.doc.downstream_action }}`, rightValue: "human_review", operator: { type: "string", operation: "equals" } }], combinator: "and" },
              renameOutput: true, outputKey: "human_review"
            },
            {
              conditions: { options: { caseSensitive: false, leftValue: "", typeValidation: "loose" }, conditions: [{ leftValue: `={{ ${$}json.doc.downstream_action }}`, rightValue: "escalate", operator: { type: "string", operation: "equals" } }], combinator: "and" },
              renameOutput: true, outputKey: "escalate"
            }
          ]
        },
        fallbackOutput: "extra"  // archive fallback
      }
    },
    // Auto-process: high confidence, file it
    {
      id: "node_auto", name: "Auto Process Document", type: "n8n-nodes-base.code", typeVersion: 2, position: [1760, 60],
      parameters: { jsCode: AUTO_PROCESS_CODE }
    },
    // Human review: send email with extracted fields and routing destination
    {
      id: "node_review", name: "Human Review Alert", type: "n8n-nodes-base.gmail", typeVersion: 2, position: [1760, 210],
      parameters: {
        sendTo: "qadautomation@gmail.com",
        subject: `={{ '[Review Required] ' + ${$}json.doc.classification_label.toUpperCase() + ' — ' + ${$}json.doc.file_name }}`,
        emailType: "html",
        message: `={{ '<h2>Document Review Required</h2><table style="border-collapse:collapse;width:100%"><tr><td style="padding:6px;border:1px solid #ddd"><b>Document ID</b></td><td style="padding:6px;border:1px solid #ddd">' + ${$}json.doc.document_id + '</td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>File</b></td><td style="padding:6px;border:1px solid #ddd">' + ${$}json.doc.file_name + '</td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>Classified As</b></td><td style="padding:6px;border:1px solid #ddd">' + ${$}json.doc.classification_label + '</td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>Confidence</b></td><td style="padding:6px;border:1px solid #ddd">' + (${$}json.doc.confidence_score * 100).toFixed(0) + '%</td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>Route To</b></td><td style="padding:6px;border:1px solid #ddd">' + (${$}json.doc.routing_destination || 'human_review_queue') + '</td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>Sender</b></td><td style="padding:6px;border:1px solid #ddd">' + (${$}json.doc.sender || 'N/A') + '</td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>Summary</b></td><td style="padding:6px;border:1px solid #ddd">' + ((${$}json.doc.classification_result || {}).summary || 'N/A') + '</td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>Extracted Fields</b></td><td style="padding:6px;border:1px solid #ddd"><pre>' + JSON.stringify(${$}json.doc.extracted_fields || {}, null, 2) + '</pre></td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>Flags</b></td><td style="padding:6px;border:1px solid #ddd">' + (${$}json.doc.flags || []).join(', ') + '</td></tr></table><p>Please review and take action in the dashboard.</p>' }}`,
        options: {}
      },
      credentials: { gmailOAuth2: { id: "bHMHyGqUtDInnHet", name: "Gmail account" } },
      continueOnFail: true
    },
    // Escalate: court docs, urgent referrals
    {
      id: "node_escalate", name: "Escalate Document", type: "n8n-nodes-base.gmail", typeVersion: 2, position: [1760, 360],
      parameters: {
        sendTo: "qadautomation@gmail.com",
        subject: `={{ '[ESCALATION] ' + ${$}json.doc.classification_label.toUpperCase() + ' — ' + ${$}json.doc.file_name }}`,
        emailType: "html",
        message: `={{ '<h2 style="color:red">Document Escalation Required</h2><p>This document has been automatically escalated and requires immediate attention.</p><table style="border-collapse:collapse;width:100%"><tr><td style="padding:6px;border:1px solid #ddd"><b>Document ID</b></td><td style="padding:6px;border:1px solid #ddd">' + ${$}json.doc.document_id + '</td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>File</b></td><td style="padding:6px;border:1px solid #ddd">' + ${$}json.doc.file_name + '</td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>Type</b></td><td style="padding:6px;border:1px solid #ddd">' + ${$}json.doc.classification_label + '</td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>Routing To</b></td><td style="padding:6px;border:1px solid #ddd">' + (${$}json.doc.routing_destination || 'legal_urgent') + '</td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>Flags</b></td><td style="padding:6px;border:1px solid #ddd">' + (${$}json.doc.flags || []).join(', ') + '</td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>Extracted Fields</b></td><td style="padding:6px;border:1px solid #ddd"><pre>' + JSON.stringify(${$}json.doc.extracted_fields || {}, null, 2) + '</pre></td></tr></table>' }}`,
        options: {}
      },
      credentials: { gmailOAuth2: { id: "bHMHyGqUtDInnHet", name: "Gmail account" } },
      continueOnFail: true
    },
    // Archive (fallback path)
    {
      id: "node_archive", name: "Archive Document", type: "n8n-nodes-base.code", typeVersion: 2, position: [1760, 510],
      parameters: { jsCode: ARCHIVE_CODE }
    },
    // Converge all paths: pull from Parse & Route (avoids Gmail/Code overwriting $json)
    {
      id: "node_prep_log", name: "Prepare Log Data", type: "n8n-nodes-base.code", typeVersion: 2, position: [2000, 300],
      parameters: { jsCode: PREP_LOG_CODE }
    },
    // Log to PostgreSQL
    {
      id: "node_log_postgres", name: "Log to PostgreSQL", type: "n8n-nodes-base.postgres", typeVersion: 2.5, position: [2220, 300],
      parameters: { operation: "executeQuery", query: LOG_SQL, options: {} },
      credentials: { postgres: { id: "MMScP2tKEgzvhkYM", name: "Postgres account" } },
      continueOnFail: true
    },
    // Success response — return document_id, classification, extracted fields, routing destination
    {
      id: "node_respond", name: "Webhook Response", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [2440, 300],
      parameters: {
        respondWith: "json",
        responseBody: `={{ { status: "success", document_id: ${$}json.document_id, classification_label: ${$}json.classification_label, confidence_score: ${$}json.confidence_score, routing_destination: (JSON.parse(${$}json.classification_result || '{}').routing_destination || null), filing_target: ${$}json.filing_target, downstream_action: ${$}json.downstream_action, review_required: ${$}json.review_required, processing_status: ${$}json.processing_status, extracted_fields: JSON.parse(${$}json.extracted_fields || '{}'), processed_at: ${$}json.processed_at } }}`,
        options: { responseCode: 200 }
      }
    },
    // Validation fail: 400 + log
    {
      id: "node_fail_respond", name: "Validation Fail Response", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [880, 420],
      parameters: {
        respondWith: "json",
        responseBody: `={{ { status: "error", error_type: "validation", errors: ${$}json.doc.validation_errors, document_id: ${$}json.doc.document_id } }}`,
        options: { responseCode: 400 }
      }
    },
    {
      id: "node_fail_log", name: "Log Validation Failure", type: "n8n-nodes-base.postgres", typeVersion: 2.5, position: [880, 560],
      parameters: {
        operation: "executeQuery",
        query: `INSERT INTO document_log (document_id, execution_id, workflow_version, client_id, source_type, file_name, file_type, raw_payload, normalized_payload, validation_passed, validation_errors, processing_status, received_at, processed_at) VALUES ('{{ $json.doc.document_id }}', {{ $json.doc.execution_id ? "'" + $json.doc.execution_id + "'" : 'NULL' }}, 'document_intake_v1', '{{ $json.doc.client_id }}', {{ $json.doc.source_type ? "'" + $json.doc.source_type + "'" : 'NULL' }}, {{ $json.doc.file_name ? "'" + $json.doc.file_name.replace(/'/g, "''") + "'" : 'NULL' }}, {{ $json.doc.file_type ? "'" + $json.doc.file_type + "'" : 'NULL' }}, '{{ JSON.stringify($json.raw_payload).replace(/'/g, "''") }}'::jsonb, '{{ JSON.stringify($json.doc).replace(/'/g, "''") }}'::jsonb, false, '{{ JSON.stringify($json.doc.validation_errors) }}'::jsonb, 'failed', '{{ $json.doc.received_at }}', NOW()) ON CONFLICT (document_id) DO NOTHING;`,
        options: {}
      },
      credentials: { postgres: { id: "MMScP2tKEgzvhkYM", name: "Postgres account" } },
      continueOnFail: true
    },
    // Global error handler
    {
      id: "node_error_catch", name: "Error Handler", type: "n8n-nodes-base.errorTrigger", typeVersion: 1, position: [0, 600],
      parameters: {}
    },
    {
      id: "node_error_log", name: "Log Workflow Error", type: "n8n-nodes-base.postgres", typeVersion: 2.5, position: [220, 600],
      parameters: {
        operation: "executeQuery",
        query: `INSERT INTO workflow_errors (execution_id, workflow_id, error_type, error_message, failed_at, retry_count, resolved) VALUES ('{{ $json.execution.id }}', 'document_intake_v1', 'fatal', '{{ ($json.error.message || 'Unknown error').replace(/'/g, "''") }}', NOW(), 0, false);`,
        options: {}
      },
      credentials: { postgres: { id: "MMScP2tKEgzvhkYM", name: "Postgres account" } },
      continueOnFail: true
    }
  ],
  connections: {
    "Document Webhook":      { main: [[{ node: "Normalize Document",       type: "main", index: 0 }]] },
    "Normalize Document":    { main: [[{ node: "Validate Document",        type: "main", index: 0 }]] },
    "Validate Document":     { main: [[{ node: "Validation Gate",          type: "main", index: 0 }]] },
    "Validation Gate": {
      main: [
        [{ node: "Extract Text",              type: "main", index: 0 }],
        [{ node: "Validation Fail Response",  type: "main", index: 0 }, { node: "Log Validation Failure", type: "main", index: 0 }]
      ]
    },
    "Extract Text":               { main: [[{ node: "Ollama Classify & Extract", type: "main", index: 0 }]] },
    "Ollama Classify & Extract":  { main: [[{ node: "Parse & Route",             type: "main", index: 0 }]] },
    "Parse & Route":              { main: [[{ node: "Route by Action",           type: "main", index: 0 }]] },
    "Route by Action": {
      main: [
        [{ node: "Auto Process Document", type: "main", index: 0 }],
        [{ node: "Human Review Alert",    type: "main", index: 0 }],
        [{ node: "Escalate Document",     type: "main", index: 0 }],
        [{ node: "Archive Document",      type: "main", index: 0 }]
      ]
    },
    "Auto Process Document": { main: [[{ node: "Prepare Log Data", type: "main", index: 0 }]] },
    "Human Review Alert":    { main: [[{ node: "Prepare Log Data", type: "main", index: 0 }]] },
    "Escalate Document":     { main: [[{ node: "Prepare Log Data", type: "main", index: 0 }]] },
    "Archive Document":      { main: [[{ node: "Prepare Log Data", type: "main", index: 0 }]] },
    "Prepare Log Data":      { main: [[{ node: "Log to PostgreSQL", type: "main", index: 0 }]] },
    "Log to PostgreSQL":     { main: [[{ node: "Webhook Response",  type: "main", index: 0 }]] },
    "Error Handler":         { main: [[{ node: "Log Workflow Error", type: "main", index: 0 }]] }
  },
  settings: { executionOrder: "v1", saveManualExecutions: true },
  staticData: null
};

async function main() {
  // Deactivate + delete old workflow
  console.log('Deactivating old workflow...');
  await req('POST', `/api/v1/workflows/${OLD_WF_ID}/deactivate`).catch(() => {});
  await req('DELETE', `/api/v1/workflows/${OLD_WF_ID}`).catch(e => console.log('Delete skipped:', e.message));

  console.log('Creating rebuilt Document Intake workflow...');
  const result = await req('POST', '/api/v1/workflows', workflow);
  if (!result.id) { console.log('Error:', JSON.stringify(result).substring(0, 300)); return; }
  console.log('Created workflow ID:', result.id);

  const active = await req('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('active:', active.active);
  console.log('Webhook: http://localhost:5678/webhook/document-intake');
}

main().catch(console.error);
