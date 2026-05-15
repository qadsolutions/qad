const http = require('http');

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1N2FhMTMyNS1mODM2LTRmOGItYTk2NC02NDA4NjJlMTQxZjYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNzNlMmRjMTgtMzU5MS00ZjljLWIyYjYtMzZhZjdlNjYwYzViIiwiaWF0IjoxNzc4Mjk1NDUxLCJleHAiOjE3ODA4MTU2MDB9.X7T72Ph9Hv1qY_I8bGB2KnFtmdJ18wVdk6rDiwSjJ9U';
const PG_CRED = { id: 'MMScP2tKEgzvhkYM', name: 'Postgres account' };

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: 'localhost', port: 5678, path, method,
      headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    }, res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => { try { resolve(JSON.parse(c.join(''))); } catch(e) { resolve(c.join('')); } }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

// ── workflow_runs INSERT template ────────────────────────────────────────────
// Called from each automation's "Log Execution" node.
// prepNode = name of the Prepare Log Data node in this workflow
// wfId     = workflow ID string
// wfName   = human-readable name
// statusExpr = JS expression (as string) that maps automation status → run_status
// outcomeExpr = JS expression for business_outcome label
// detailExpr  = JS expression for business_outcome_detail object (NOT stringified — let template do it)
function makeRunsSql(prepNode, wfId, wfName, statusExpr, outcomeExpr, detailExpr) {
  // n8n template mode — $('Node Name').first().json
  const p = `$('${prepNode}').first().json`;
  return `INSERT INTO workflow_runs (
  execution_id, workflow_id, workflow_name, workflow_version, client_id,
  started_at, ended_at,
  run_status, source_type,
  business_outcome, business_outcome_detail,
  ollama_used, ollama_fallback
) VALUES (
  '{{ ${p}.execution_id || 'exec_unknown' }}',
  '${wfId}',
  '${wfName}',
  '${wfId}',
  '{{ ${p}.client_id || 'default' }}',
  {{ ${p}.received_at ? "'" + ${p}.received_at + "'::timestamptz" : 'NOW()' }},
  NOW(),
  '{{ ${statusExpr} }}',
  {{ ${p}.source_type ? "'" + ${p}.source_type + "'" : 'NULL' }},
  '{{ ${outcomeExpr} }}',
  '{{ JSON.stringify(${detailExpr}).replace(/'/g, "''") }}'::jsonb,
  {{ ${p}.ai_model_used ? 'true' : 'false' }},
  {{ ${p}.ai_fallback_used || false }}
)
ON CONFLICT (execution_id) DO NOTHING;`;
}

// ── Workflow configs ─────────────────────────────────────────────────────────
const WORKFLOWS = [
  {
    id: '4aPludoDhXMyAk7x',
    logNodeId: 'node_log_postgres',
    logNodeName: 'Log to PostgreSQL',
    prepNodeName: 'Prepare Log Data',
    newNodeId: 'node_log_runs',
    newNodeName: 'Log Execution',
    xOffset: 0, yOffset: 200,   // position relative to log node
    sql: makeRunsSql(
      'Prepare Log Data',
      'customer_intake_v1',
      'Customer Intake & Qualification v1',
      `(() => { const t = $('Prepare Log Data').first().json.qualification_tier; return ['hot','warm'].includes(t) ? 'success' : t === 'disqualified' ? 'failure' : 'partial'; })()`,
      `'intake_' + ($('Prepare Log Data').first().json.qualification_tier || 'unknown')`,
      `{ tier: $('Prepare Log Data').first().json.qualification_tier, score: $('Prepare Log Data').first().json.qualification_score, action: $('Prepare Log Data').first().json.recommended_action }`
    )
  },
  {
    id: 'riCozLIp9vwM1mjt',
    logNodeId: 'node_log_postgres',
    logNodeName: 'Log to PostgreSQL',
    prepNodeName: 'Prepare Log Data',
    newNodeId: 'node_log_runs',
    newNodeName: 'Log Execution',
    xOffset: 0, yOffset: 200,
    sql: makeRunsSql(
      'Prepare Log Data',
      'document_intake_v1',
      'Document Intake & Processing Agent v1',
      `(() => { const s = $('Prepare Log Data').first().json.processing_status; return s === 'success' || s === 'auto_process' ? 'success' : s === 'failed' || s === 'error' ? 'failure' : 'partial'; })()`,
      `'document_' + ($('Prepare Log Data').first().json.downstream_action || 'unknown')`,
      `{ label: $('Prepare Log Data').first().json.classification_label, confidence: $('Prepare Log Data').first().json.confidence_score, action: $('Prepare Log Data').first().json.downstream_action, routing: $('Prepare Log Data').first().json.routing_destination }`
    )
  },
  {
    id: 'muVXGTx7suWyjaiT',
    logNodeId: 'n_log_pg',
    logNodeName: 'Log to PostgreSQL',
    prepNodeName: 'Prepare Log Data',
    newNodeId: 'n_log_runs',
    newNodeName: 'Log Execution',
    xOffset: 0, yOffset: 200,
    sql: makeRunsSql(
      'Prepare Log Data',
      'appointment_scheduling_v1',
      'Appointment & Scheduling Automation v1',
      `(() => { const s = $('Prepare Log Data').first().json.status; return ['confirmed','rescheduled','cancelled'].includes(s) ? 'success' : s === 'rejected' ? 'failure' : 'partial'; })()`,
      `'appointment_' + ($('Prepare Log Data').first().json.status || 'unknown')`,
      `{ service: $('Prepare Log Data').first().json.service_type, status: $('Prepare Log Data').first().json.status, auto_confirmed: $('Prepare Log Data').first().json.auto_confirmed }`
    )
  }
];

async function patchWorkflow(cfg) {
  console.log(`\nPatching ${cfg.id}...`);
  const wf = await req('GET', `/api/v1/workflows/${cfg.id}`);
  if (!wf.nodes) { console.error('  Failed to fetch'); return; }

  // Find the Log to PostgreSQL node to get its position
  const logNode = wf.nodes.find(n => n.id === cfg.logNodeId);
  if (!logNode) { console.error('  Log node not found'); return; }

  // Skip if already patched
  if (wf.nodes.find(n => n.id === cfg.newNodeId)) {
    console.log('  Already patched — skipping');
    return;
  }

  // Add the Log Execution node
  const newNode = {
    id: cfg.newNodeId,
    name: cfg.newNodeName,
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.5,
    position: [logNode.position[0] + cfg.xOffset, logNode.position[1] + cfg.yOffset + 160],
    parameters: { operation: 'executeQuery', query: cfg.sql, options: {} },
    credentials: { postgres: PG_CRED },
    continueOnFail: true
  };
  wf.nodes.push(newNode);

  // Add connection: Log to PostgreSQL → Log Execution (parallel with Webhook Response)
  const logNodeConns = wf.connections[cfg.logNodeName];
  if (logNodeConns && logNodeConns.main && logNodeConns.main[0]) {
    logNodeConns.main[0].push({ node: cfg.newNodeName, type: 'main', index: 0 });
  } else {
    wf.connections[cfg.logNodeName] = { main: [[{ node: cfg.newNodeName, type: 'main', index: 0 }]] };
  }
  wf.connections[cfg.newNodeName] = { main: [[]] };

  // Strip settings fields not accepted by PUT endpoint
  const { binaryMode, timeSavedMode, availableInMCP, ...cleanSettings } = wf.settings || {};
  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: cleanSettings, staticData: wf.staticData || null };
  const updated = await req('PUT', `/api/v1/workflows/${cfg.id}`, payload);
  if (updated.message) { console.error('  PUT failed:', updated.message); return; }

  await req('POST', `/api/v1/workflows/${cfg.id}/activate`, {});
  console.log(`  Done — added "${cfg.newNodeName}" node`);
}

async function run() {
  for (const cfg of WORKFLOWS) {
    await patchWorkflow(cfg);
  }
  console.log('\nAll workflows patched.');
}

run().catch(console.error);
