const http = require('http');

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1N2FhMTMyNS1mODM2LTRmOGItYTk2NC02NDA4NjJlMTQxZjYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNzNlMmRjMTgtMzU5MS00ZjljLWIyYjYtMzZhZjdlNjYwYzViIiwiaWF0IjoxNzc4Mjk1NDUxLCJleHAiOjE3ODA4MTU2MDB9.X7T72Ph9Hv1qY_I8bGB2KnFtmdJ18wVdk6rDiwSjJ9U';
const WF_ID = '4aPludoDhXMyAk7x';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: 'localhost', port: 5678, path, method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => resolve(JSON.parse(c.join(''))));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const $ = String.fromCharCode(36);

// Code node that pulls intake from Qualification Scoring regardless of which path ran
const PREP_LOG_CODE = [
  `const scored = ${$}('Qualification Scoring').first().json;`,
  `const intake = scored.intake || {};`,
  `const raw = scored.raw_payload || {};`,
  ``,
  `return [{`,
  `  json: {`,
  `    intake_id: intake.intake_id || 'unknown',`,
  `    execution_id: intake.execution_id || null,`,
  `    workflow_version: intake.workflow_version || 'customer_intake_v1',`,
  `    client_id: intake.client_id || 'default',`,
  `    source_type: intake.source_type || null,`,
  `    source_channel: intake.source_channel || null,`,
  `    contact_name: intake.contact_name || null,`,
  `    contact_email: intake.contact_email || null,`,
  `    contact_phone: intake.contact_phone || null,`,
  `    company_name: intake.company_name || null,`,
  `    request_type: intake.request_type || null,`,
  `    service_category: intake.service_category || null,`,
  `    urgency_level: intake.urgency_level || null,`,
  `    monthly_budget: intake.monthly_budget || 0,`,
  `    message_body: intake.message_body || null,`,
  `    raw_payload: JSON.stringify(raw),`,
  `    normalized_payload: JSON.stringify(intake),`,
  `    validation_passed: intake.validation_passed || false,`,
  `    validation_errors: JSON.stringify(intake.validation_errors || []),`,
  `    is_spam: intake.is_spam || false,`,
  `    is_duplicate: intake.is_duplicate || false,`,
  `    classification_result: JSON.stringify(intake.classification_result || {}),`,
  `    confidence_score: intake.confidence_score || 0,`,
  `    ai_model_used: intake.ai_model_used || null,`,
  `    ai_model_source: intake.ai_model_source || 'none',`,
  `    ai_response_time_ms: intake.ai_response_time_ms || 0,`,
  `    ai_fallback_used: intake.ai_fallback_used || false,`,
  `    qualification_score: intake.qualification_score || 0,`,
  `    qualification_tier: intake.qualification_tier || null,`,
  `    recommended_action: intake.recommended_action || null,`,
  `    route_taken: intake.route_taken || null,`,
  `    human_review_needed: intake.human_review_needed || false,`,
  `    flags: JSON.stringify(intake.flags || []),`,
  `    received_at: intake.received_at || new Date().toISOString(),`,
  `    processed_at: intake.processed_at || new Date().toISOString()`,
  `  }`,
  `}];`
].join('\n');

// Clean SQL using flat $json fields — no nested $json.intake
const LOG_SQL = [
  `INSERT INTO intake_log (`,
  `  intake_id, execution_id, workflow_version, client_id,`,
  `  source_type, source_channel, contact_name, contact_email,`,
  `  contact_phone, company_name, request_type, service_category,`,
  `  urgency_level, monthly_budget, message_body,`,
  `  raw_payload, normalized_payload,`,
  `  validation_passed, validation_errors, is_spam, is_duplicate,`,
  `  classification_result, confidence_score,`,
  `  ai_model_used, ai_model_source, ai_response_time_ms, ai_fallback_used,`,
  `  qualification_score, qualification_tier, recommended_action,`,
  `  route_taken, human_review_needed, flags, received_at, processed_at`,
  `) VALUES (`,
  `  '{{ $json.intake_id }}',`,
  `  {{ $json.execution_id ? "'" + $json.execution_id + "'" : 'NULL' }},`,
  `  '{{ $json.workflow_version }}',`,
  `  '{{ $json.client_id }}',`,
  `  {{ $json.source_type ? "'" + $json.source_type + "'" : 'NULL' }},`,
  `  {{ $json.source_channel ? "'" + $json.source_channel + "'" : 'NULL' }},`,
  `  {{ $json.contact_name ? "'" + $json.contact_name.replace(/'/g, "''") + "'" : 'NULL' }},`,
  `  {{ $json.contact_email ? "'" + $json.contact_email + "'" : 'NULL' }},`,
  `  {{ $json.contact_phone ? "'" + $json.contact_phone + "'" : 'NULL' }},`,
  `  {{ $json.company_name ? "'" + $json.company_name.replace(/'/g, "''") + "'" : 'NULL' }},`,
  `  {{ $json.request_type ? "'" + $json.request_type + "'" : 'NULL' }},`,
  `  {{ $json.service_category ? "'" + $json.service_category + "'" : 'NULL' }},`,
  `  {{ $json.urgency_level ? "'" + $json.urgency_level + "'" : 'NULL' }},`,
  `  {{ $json.monthly_budget || 0 }},`,
  `  {{ $json.message_body ? "'" + $json.message_body.replace(/'/g, "''") + "'" : 'NULL' }},`,
  `  '{{ $json.raw_payload.replace(/'/g, "''") }}'::jsonb,`,
  `  '{{ $json.normalized_payload.replace(/'/g, "''") }}'::jsonb,`,
  `  {{ $json.validation_passed }},`,
  `  '{{ $json.validation_errors }}'::jsonb,`,
  `  {{ $json.is_spam }},`,
  `  {{ $json.is_duplicate }},`,
  `  '{{ $json.classification_result }}'::jsonb,`,
  `  {{ $json.confidence_score || 0 }},`,
  `  {{ $json.ai_model_used ? "'" + $json.ai_model_used + "'" : 'NULL' }},`,
  `  '{{ $json.ai_model_source }}',`,
  `  {{ $json.ai_response_time_ms || 0 }},`,
  `  {{ $json.ai_fallback_used }},`,
  `  {{ $json.qualification_score || 0 }},`,
  `  {{ $json.qualification_tier ? "'" + $json.qualification_tier + "'" : 'NULL' }},`,
  `  {{ $json.recommended_action ? "'" + $json.recommended_action + "'" : 'NULL' }},`,
  `  {{ $json.route_taken ? "'" + $json.route_taken + "'" : 'NULL' }},`,
  `  {{ $json.human_review_needed }},`,
  `  '{{ $json.flags }}'::jsonb,`,
  `  '{{ $json.received_at }}',`,
  `  '{{ $json.processed_at }}'`,
  `)`,
  `ON CONFLICT (intake_id) DO NOTHING`,
  `RETURNING intake_id, qualification_tier, recommended_action;`
].join('\n');

// Response node — reads from the prep node output (flat $json)
const $2 = String.fromCharCode(36);

async function main() {
  console.log('Fetching workflow...');
  const wf = await req('GET', `/api/v1/workflows/${WF_ID}`);

  // Find the Log to PostgreSQL node position to place prep node before it
  const logNode = wf.nodes.find(n => n.name === 'Log to PostgreSQL');
  const [lx, ly] = logNode.position;

  // Add Prepare Log Data code node
  const prepNode = {
    id: 'node_prep_log',
    name: 'Prepare Log Data',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [lx - 220, ly],
    parameters: { jsCode: PREP_LOG_CODE }
  };
  // Remove if already exists from a previous patch
  wf.nodes = wf.nodes.filter(n => n.name !== 'Prepare Log Data');
  wf.nodes.push(prepNode);

  // Update Log to PostgreSQL SQL to use flat fields
  logNode.parameters.query = LOG_SQL;

  // Fix Webhook Response to read from Prepare Log Data
  const respNode = wf.nodes.find(n => n.name === 'Webhook Response');
  respNode.parameters = {
    respondWith: 'json',
    responseBody: `={{ { status: "success", intake_id: ${$2}json.intake_id, qualification_tier: ${$2}json.qualification_tier, qualification_score: ${$2}json.qualification_score, recommended_action: ${$2}json.recommended_action, human_review_needed: ${$2}json.human_review_needed, processed_at: ${$2}json.processed_at } }}`,
    options: { responseCode: 200 }
  };

  // Rewire: everything that goes to Log to PostgreSQL now goes through Prepare Log Data first
  // Find all connections pointing to Log to PostgreSQL and redirect to Prepare Log Data
  Object.keys(wf.connections).forEach(fromNode => {
    wf.connections[fromNode].main.forEach((outputs, i) => {
      if (!outputs) return;
      wf.connections[fromNode].main[i] = outputs.map(o =>
        o.node === 'Log to PostgreSQL' ? { ...o, node: 'Prepare Log Data' } : o
      );
    });
  });

  // Wire Prepare Log Data → Log to PostgreSQL
  wf.connections['Prepare Log Data'] = {
    main: [[{ node: 'Log to PostgreSQL', type: 'main', index: 0 }]]
  };

  // Wire Log to PostgreSQL → Webhook Response
  wf.connections['Log to PostgreSQL'] = {
    main: [[{ node: 'Webhook Response', type: 'main', index: 0 }]]
  };

  console.log('Prep node added, connections rewired.');

  const payload = {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: { executionOrder: wf.settings.executionOrder, saveManualExecutions: wf.settings.saveManualExecutions },
    staticData: wf.staticData
  };

  const result = await req('PUT', `/api/v1/workflows/${WF_ID}`, payload);
  console.log(result.id ? 'Updated: ' + result.id : 'Error: ' + JSON.stringify(result).substring(0, 200));

  const active = await req('POST', `/api/v1/workflows/${WF_ID}/activate`);
  console.log('active:', active.active);
}

main().catch(console.error);
