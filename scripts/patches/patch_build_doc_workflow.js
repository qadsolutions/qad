const http = require('http');

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1N2FhMTMyNS1mODM2LTRmOGItYTk2NC02NDA4NjJlMTQxZjYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNzNlMmRjMTgtMzU5MS00ZjljLWIyYjYtMzZhZjdlNjYwYzViIiwiaWF0IjoxNzc4Mjk1NDUxLCJleHAiOjE3ODA4MTU2MDB9.X7T72Ph9Hv1qY_I8bGB2KnFtmdJ18wVdk6rDiwSjJ9U';

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

const NORMALIZE_CODE = `
const raw = ${$}input.first().json.body || ${$}input.first().json;
const now = new Date().toISOString();
const documentId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
const executionId = ${$}execution?.id || 'exec_' + Date.now();

const sourceType = raw.source_type || (
  raw.sender ? 'email' :
  raw.upload_session ? 'upload' :
  'webhook'
);

const doc = {
  document_id: documentId,
  execution_id: executionId,
  workflow_version: 'document_intake_v1',
  client_id: raw.client_id || 'default',
  source_type: sourceType,
  source_channel: raw.source_channel || null,
  sender: raw.sender || null,
  subject: raw.subject || null,
  file_name: raw.file_name || null,
  file_type: (raw.file_type || (raw.file_name ? raw.file_name.split('.').pop().toLowerCase() : null)),
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
  confidence_score: null,
  extracted_fields: {},
  filing_target: null,
  downstream_action: null,
  review_required: false,
  processing_status: 'processing',
  ai_model_used: null,
  ai_model_source: null,
  ai_response_time_ms: null,
  ai_fallback_used: false,
  error_message: null,
  flags: []
};

return [{ json: { doc, raw_payload: raw } }];
`.trim();

const VALIDATE_CODE = `
const data = ${$}input.first().json;
const doc = { ...data.doc };
doc.flags = Array.isArray(doc.flags) ? [...doc.flags] : [];
doc.validation_errors = [];
const errors = [];

if (!doc.file_name) errors.push('file_name is required');
if (!doc.document_text && !doc.file_content_base64) {
  doc.flags.push('no_content_provided');
}
const allowedTypes = ['pdf','png','jpg','jpeg','tiff','tif','docx','txt','doc','heic'];
if (doc.file_type && !allowedTypes.includes(doc.file_type.toLowerCase())) {
  errors.push('Unsupported file type: ' + doc.file_type);
}
if (doc.file_size && doc.file_size > 52428800) {
  errors.push('File exceeds 50MB limit');
}
if (!doc.document_text && !doc.file_content_base64) {
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

const EXTRACT_TEXT_CODE = `
const data = ${$}input.first().json;
const doc = { ...data.doc };
doc.flags = Array.isArray(doc.flags) ? [...doc.flags] : [];

// If document_text already provided, use it
if (doc.document_text && doc.document_text.trim().length > 10) {
  doc.flags.push('text_provided_directly');
  return [{ json: { doc, raw_payload: data.raw_payload } }];
}

// Attempt naive text extraction from base64 if it's a text-based file
if (doc.file_content_base64) {
  try {
    const decoded = Buffer.from(doc.file_content_base64, 'base64').toString('utf-8');
    // Check if decoded content looks like readable text (not binary)
    const printable = decoded.replace(/[\\x00-\\x08\\x0e-\\x1f\\x7f-\\x9f]/g, '');
    const ratio = printable.length / decoded.length;
    if (ratio > 0.85 && printable.length > 20) {
      doc.document_text = printable.substring(0, 8000); // cap at 8k chars for Ollama
      doc.flags.push('text_extracted_from_content');
    } else {
      doc.flags.push('binary_content_ocr_needed');
      doc.document_text = '[Binary content — OCR required for full extraction]';
    }
  } catch(e) {
    doc.flags.push('text_extraction_failed');
    doc.document_text = '[Text extraction failed]';
  }
} else {
  doc.document_text = '[No content provided — classification based on metadata only]';
  doc.flags.push('metadata_only_classification');
}

return [{ json: { doc, raw_payload: data.raw_payload } }];
`.trim();

const OLLAMA_PARSE_CODE = [
  `const ollamaData = ${$}input.first().json;`,
  `const prevData = ${$}('Validation Gate').first().json;`,
  `const doc = { ...prevData.doc };`,
  `doc.flags = Array.isArray(doc.flags) ? [...doc.flags] : [];`,
  ``,
  `// Also carry forward text extraction if it ran`,
  `try {`,
  `  const extracted = ${$}('Extract Text').first().json;`,
  `  if (extracted && extracted.doc) {`,
  `    doc.document_text = extracted.doc.document_text || doc.document_text;`,
  `    doc.flags = [...new Set([...doc.flags, ...(extracted.doc.flags || [])])];`,
  `  }`,
  `} catch(e) {}`,
  ``,
  `const ollamaRaw = ollamaData.response || null;`,
  `let classification = null;`,
  ``,
  `try {`,
  `  if (!ollamaRaw || ollamaData.error) throw new Error('Ollama unavailable');`,
  `  const parsed = typeof ollamaRaw === 'string' ? JSON.parse(ollamaRaw) : ollamaRaw;`,
  `  if (!parsed.classification_label || typeof parsed.confidence !== 'number') throw new Error('Malformed output');`,
  ``,
  `  classification = {`,
  `    classification_label: parsed.classification_label || 'unknown',`,
  `    confidence: parsed.confidence || 0,`,
  `    filing_target: parsed.filing_target || 'general',`,
  `    downstream_action: parsed.downstream_action || 'human_review',`,
  `    extracted_fields: parsed.extracted_fields || {},`,
  `    summary: parsed.summary || '',`,
  `    flags: parsed.flags || []`,
  `  };`,
  ``,
  `  doc.ai_model_used = 'llama3.2';`,
  `  doc.ai_model_source = 'ollama_local';`,
  `  doc.ai_fallback_used = false;`,
  ``,
  `  if (parsed.confidence < 0.5) {`,
  `    doc.review_required = true;`,
  `    doc.flags.push('low_ai_confidence');`,
  `  }`,
  `  doc.flags = [...new Set([...doc.flags, ...classification.flags])];`,
  `} catch(e) {`,
  `  classification = {`,
  `    classification_label: 'unknown',`,
  `    confidence: 0,`,
  `    filing_target: 'review_queue',`,
  `    downstream_action: 'human_review',`,
  `    extracted_fields: {},`,
  `    summary: 'AI classification unavailable — routed to human review.',`,
  `    flags: ['ai_fallback_triggered']`,
  `  };`,
  `  doc.ai_model_used = null;`,
  `  doc.ai_model_source = 'fallback';`,
  `  doc.ai_fallback_used = true;`,
  `  doc.review_required = true;`,
  `  doc.flags.push('ai_fallback_triggered');`,
  `}`,
  ``,
  `doc.classification_label = classification.classification_label;`,
  `doc.confidence_score = classification.confidence;`,
  `doc.filing_target = classification.filing_target;`,
  `doc.downstream_action = classification.downstream_action;`,
  `doc.extracted_fields = classification.extracted_fields;`,
  `doc.classification_result = classification;`,
  `doc.processed_at = new Date().toISOString();`,
  ``,
  `return [{ json: { doc, raw_payload: prevData.raw_payload } }];`
].join('\n');

const PREP_LOG_CODE = [
  `const scored = ${$}('Parse Ollama Response').first().json;`,
  `const doc = scored.doc || {};`,
  `const raw = scored.raw_payload || {};`,
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
  `    processing_status: doc.review_required ? 'pending_review' : 'success',`,
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
  '{{ $json.classification_result }}'::jsonb,
  '{{ $json.extracted_fields }}'::jsonb,
  {{ $json.filing_target ? "'" + $json.filing_target + "'" : 'NULL' }},
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

const OLLAMA_BODY = `={
  "model": "llama3.2",
  "prompt": "You are a document classification AI. Analyze this document and return ONLY a valid JSON object.\\n\\nDocument Metadata:\\nFile: {{ $json.doc.file_name }}\\nType: {{ $json.doc.file_type }}\\nSender: {{ $json.doc.sender }}\\nSubject: {{ $json.doc.subject }}\\n\\nDocument Text (first 2000 chars):\\n{{ ($json.doc.document_text || '').substring(0, 2000) }}\\n\\nClassify and extract. Return exactly this JSON:\\n{\\"classification_label\\": \\"invoice|contract|intake_form|referral|receipt|court_document|id_document|tax_document|real_estate|correspondence|unknown\\", \\"confidence\\": 0.85, \\"filing_target\\": \\"folder/path\\", \\"downstream_action\\": \\"auto_process|human_review|archive|escalate\\", \\"extracted_fields\\": {}, \\"summary\\": \\"one sentence\\", \\"flags\\": []}",
  "stream": false,
  "format": "json"
}`;

const workflow = {
  name: "Document Intake & Processing Agent v1",
  nodes: [
    {
      id: "node_webhook", name: "Document Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 300],
      parameters: { httpMethod: "POST", path: "document-intake", responseMode: "responseNode", options: {} }
    },
    {
      id: "node_normalize", name: "Normalize Document", type: "n8n-nodes-base.code", typeVersion: 2, position: [220, 300],
      parameters: { jsCode: NORMALIZE_CODE }
    },
    {
      id: "node_validate", name: "Validate Document", type: "n8n-nodes-base.code", typeVersion: 2, position: [440, 300],
      parameters: { jsCode: VALIDATE_CODE }
    },
    {
      id: "node_validation_gate", name: "Validation Gate", type: "n8n-nodes-base.if", typeVersion: 2, position: [660, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
          conditions: [{ leftValue: "={{ $json.doc.validation_passed }}", rightValue: true, operator: { type: "boolean", operation: "equals" } }],
          combinator: "and"
        }
      }
    },
    {
      id: "node_extract_text", name: "Extract Text", type: "n8n-nodes-base.code", typeVersion: 2, position: [880, 200],
      parameters: { jsCode: EXTRACT_TEXT_CODE }
    },
    {
      id: "node_ollama", name: "Ollama Classify & Extract", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [1100, 200],
      parameters: {
        method: "POST", url: "http://host.docker.internal:11434/api/generate",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
        sendBody: true, contentType: "raw", rawContentType: "application/json",
        body: OLLAMA_BODY,
        options: { timeout: 60000 }
      },
      continueOnFail: true
    },
    {
      id: "node_ollama_parse", name: "Parse Ollama Response", type: "n8n-nodes-base.code", typeVersion: 2, position: [1320, 200],
      parameters: { jsCode: OLLAMA_PARSE_CODE }
    },
    {
      id: "node_route", name: "Route by Action", type: "n8n-nodes-base.switch", typeVersion: 3, position: [1540, 200],
      parameters: {
        mode: "rules",
        rules: {
          values: [
            {
              conditions: { options: { caseSensitive: false, leftValue: "", typeValidation: "loose" }, conditions: [{ leftValue: "={{ $json.doc.downstream_action }}", rightValue: "auto_process", operator: { type: "string", operation: "equals" } }], combinator: "and" },
              renameOutput: true, outputKey: "auto_process"
            },
            {
              conditions: { options: { caseSensitive: false, leftValue: "", typeValidation: "loose" }, conditions: [{ leftValue: "={{ $json.doc.downstream_action }}", rightValue: "human_review", operator: { type: "string", operation: "equals" } }], combinator: "and" },
              renameOutput: true, outputKey: "human_review"
            },
            {
              conditions: { options: { caseSensitive: false, leftValue: "", typeValidation: "loose" }, conditions: [{ leftValue: "={{ $json.doc.downstream_action }}", rightValue: "escalate", operator: { type: "string", operation: "equals" } }], combinator: "and" },
              renameOutput: true, outputKey: "escalate"
            }
          ]
        },
        fallbackOutput: "extra"
      }
    },
    {
      id: "node_auto_process", name: "Auto Process Document", type: "n8n-nodes-base.code", typeVersion: 2, position: [1760, 80],
      parameters: {
        jsCode: `const doc = ${$}input.first().json.doc;\nreturn [{ json: { doc, action_taken: 'auto_processed', filed_to: doc.filing_target, processed_at: new Date().toISOString() } }];`
      }
    },
    {
      id: "node_review_notify", name: "Human Review Alert", type: "n8n-nodes-base.gmail", typeVersion: 2, position: [1760, 230],
      parameters: {
        sendTo: "qadautomation@gmail.com",
        subject: "={{ '⚠️ Document Review Required: ' + $json.doc.file_name }}",
        emailType: "html",
        message: "={{ '<h2>Document Review Required</h2><p><strong>File:</strong> ' + $json.doc.file_name + '<br><strong>Type:</strong> ' + $json.doc.file_type + '<br><strong>Classified as:</strong> ' + $json.doc.classification_label + '<br><strong>Confidence:</strong> ' + ($json.doc.confidence_score * 100).toFixed(0) + '%<br><strong>Sender:</strong> ' + $json.doc.sender + '<br><strong>Document ID:</strong> ' + $json.doc.document_id + '</p><p><strong>AI Summary:</strong> ' + (($json.doc.classification_result || {}).summary || 'N/A') + '</p><p>Please review and take action in the dashboard.</p>' }}",
        options: {}
      },
      credentials: { gmailOAuth2: { id: "bHMHyGqUtDInnHet", name: "Gmail account" } },
      continueOnFail: true
    },
    {
      id: "node_escalate", name: "Escalate Document", type: "n8n-nodes-base.gmail", typeVersion: 2, position: [1760, 380],
      parameters: {
        sendTo: "qadautomation@gmail.com",
        subject: "={{ '🚨 ESCALATION: ' + $json.doc.file_name }}",
        emailType: "html",
        message: "={{ '<h2>Document Escalation</h2><p>A document has been flagged for immediate escalation.</p><p><strong>File:</strong> ' + $json.doc.file_name + '<br><strong>Document ID:</strong> ' + $json.doc.document_id + '<br><strong>Flags:</strong> ' + ($json.doc.flags || []).join(', ') + '</p>' }}",
        options: {}
      },
      credentials: { gmailOAuth2: { id: "bHMHyGqUtDInnHet", name: "Gmail account" } },
      continueOnFail: true
    },
    {
      id: "node_archive", name: "Archive Document", type: "n8n-nodes-base.code", typeVersion: 2, position: [1760, 510],
      parameters: {
        jsCode: `const doc = ${$}input.first().json.doc;\nreturn [{ json: { doc, action_taken: 'archived', filed_to: 'archive/' + (doc.classification_label || 'unknown'), archived_at: new Date().toISOString() } }];`
      }
    },
    {
      id: "node_prep_log", name: "Prepare Log Data", type: "n8n-nodes-base.code", typeVersion: 2, position: [2000, 300],
      parameters: { jsCode: PREP_LOG_CODE }
    },
    {
      id: "node_log_postgres", name: "Log to PostgreSQL", type: "n8n-nodes-base.postgres", typeVersion: 2.5, position: [2220, 300],
      parameters: { operation: "executeQuery", query: LOG_SQL, options: {} },
      credentials: { postgres: { id: "MMScP2tKEgzvhkYM", name: "Postgres account" } },
      continueOnFail: true
    },
    {
      id: "node_respond", name: "Webhook Response", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [2440, 300],
      parameters: {
        respondWith: "json",
        responseBody: `={{ { status: "success", document_id: ${$}json.document_id, classification_label: ${$}json.classification_label, confidence_score: ${$}json.confidence_score, downstream_action: ${$}json.downstream_action, review_required: ${$}json.review_required, processing_status: ${$}json.processing_status, processed_at: ${$}json.processed_at } }}`,
        options: { responseCode: 200 }
      }
    },
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
    "Document Webhook": { main: [[{ node: "Normalize Document", type: "main", index: 0 }]] },
    "Normalize Document": { main: [[{ node: "Validate Document", type: "main", index: 0 }]] },
    "Validate Document": { main: [[{ node: "Validation Gate", type: "main", index: 0 }]] },
    "Validation Gate": {
      main: [
        [{ node: "Extract Text", type: "main", index: 0 }],
        [{ node: "Validation Fail Response", type: "main", index: 0 }, { node: "Log Validation Failure", type: "main", index: 0 }]
      ]
    },
    "Extract Text": { main: [[{ node: "Ollama Classify & Extract", type: "main", index: 0 }]] },
    "Ollama Classify & Extract": { main: [[{ node: "Parse Ollama Response", type: "main", index: 0 }]] },
    "Parse Ollama Response": { main: [[{ node: "Route by Action", type: "main", index: 0 }]] },
    "Route by Action": {
      main: [
        [{ node: "Auto Process Document", type: "main", index: 0 }],
        [{ node: "Human Review Alert", type: "main", index: 0 }],
        [{ node: "Escalate Document", type: "main", index: 0 }],
        [{ node: "Archive Document", type: "main", index: 0 }]
      ]
    },
    "Auto Process Document": { main: [[{ node: "Prepare Log Data", type: "main", index: 0 }]] },
    "Human Review Alert": { main: [[{ node: "Prepare Log Data", type: "main", index: 0 }]] },
    "Escalate Document": { main: [[{ node: "Prepare Log Data", type: "main", index: 0 }]] },
    "Archive Document": { main: [[{ node: "Prepare Log Data", type: "main", index: 0 }]] },
    "Prepare Log Data": { main: [[{ node: "Log to PostgreSQL", type: "main", index: 0 }]] },
    "Log to PostgreSQL": { main: [[{ node: "Webhook Response", type: "main", index: 0 }]] },
    "Error Handler": { main: [[{ node: "Log Workflow Error", type: "main", index: 0 }]] }
  },
  settings: { executionOrder: "v1", saveManualExecutions: true },
  staticData: null
};

async function main() {
  console.log('Creating Document Intake workflow...');
  const result = await req('POST', '/api/v1/workflows', workflow);
  if (!result.id) { console.log('Error:', JSON.stringify(result).substring(0, 300)); return; }
  console.log('Created workflow ID:', result.id);

  const active = await req('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('active:', active.active);
  console.log('Webhook URL: http://localhost:5678/webhook/document-intake');
}

main().catch(console.error);
