const http = require('http');

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1N2FhMTMyNS1mODM2LTRmOGItYTk2NC02NDA4NjJlMTQxZjYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNzNlMmRjMTgtMzU5MS00ZjljLWIyYjYtMzZhZjdlNjYwYzViIiwiaWF0IjoxNzc4Mjk1NDUxLCJleHAiOjE3ODA4MTU2MDB9.X7T72Ph9Hv1qY_I8bGB2KnFtmdJ18wVdk6rDiwSjJ9U';
const WF_ID = 'riCozLIp9vwM1mjt';

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

// Prep Log Data — add routing_destination to output so it's available downstream
const PREP_LOG_CODE_FIXED = [
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
  `    routing_destination: doc.routing_destination || null,`,
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

async function main() {
  console.log('Fetching workflow...');
  const wf = await req('GET', `/api/v1/workflows/${WF_ID}`);

  // Fix Prep Log Data to include routing_destination
  const prepNode = wf.nodes.find(n => n.name === 'Prepare Log Data');
  prepNode.parameters.jsCode = PREP_LOG_CODE_FIXED;

  // Fix Webhook Response to read from Prepare Log Data (not Postgres RETURNING)
  // After Postgres, $json only has RETURNING columns. Read named node instead.
  const respNode = wf.nodes.find(n => n.name === 'Webhook Response');
  respNode.parameters = {
    respondWith: 'json',
    responseBody: `={{ (() => { const d = ${$}('Prepare Log Data').first().json; return { status: "success", document_id: d.document_id, classification_label: d.classification_label, confidence_score: d.confidence_score, routing_destination: d.routing_destination, filing_target: d.filing_target, downstream_action: d.downstream_action, review_required: d.review_required, processing_status: d.processing_status, extracted_fields: JSON.parse(d.extracted_fields || '{}'), ai_fallback_used: d.ai_fallback_used, processed_at: d.processed_at }; })() }}`,
    options: { responseCode: 200 }
  };

  const payload = {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: { executionOrder: wf.settings.executionOrder, saveManualExecutions: wf.settings.saveManualExecutions },
    staticData: wf.staticData
  };

  const result = await req('PUT', `/api/v1/workflows/${WF_ID}`, payload);
  console.log(result.id ? 'Updated: ' + result.id : 'Error: ' + JSON.stringify(result).substring(0, 300));

  const active = await req('POST', `/api/v1/workflows/${WF_ID}/activate`);
  console.log('active:', active.active);
}

main().catch(console.error);
