const http = require('http');

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1N2FhMTMyNS1mODM2LTRmOGItYTk2NC02NDA4NjJlMTQxZjYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNzNlMmRjMTgtMzU5MS00ZjljLWIyYjYtMzZhZjdlNjYwYzViIiwiaWF0IjoxNzc4Mjk1NDUxLCJleHAiOjE3ODA4MTU2MDB9.X7T72Ph9Hv1qY_I8bGB2KnFtmdJ18wVdk6rDiwSjJ9U';
const WORKFLOW_ID = '4aPludoDhXMyAk7x';

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

async function run() {
  console.log('Fetching intake workflow...');
  const wf = await req('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  if (!wf.nodes) { console.error('Failed:', JSON.stringify(wf).substring(0, 200)); return; }

  const logNode = wf.nodes.find(n => n.id === 'node_log_postgres');
  if (!logNode) { console.error('node_log_postgres not found'); return; }

  const oldSql = logNode.parameters.query;

  // Replace the static is_duplicate value with a live DB subquery.
  // The subquery checks: does any OTHER row (different intake_id) with this email already exist?
  const newSql = oldSql.replace(
    '{{ $json.is_duplicate }}',
    `(SELECT EXISTS(\n    SELECT 1 FROM intake_log\n    WHERE contact_email = '{{ $json.contact_email }}'\n    AND   intake_id    != '{{ $json.intake_id }}'\n  ))`
  );

  if (newSql === oldSql) {
    console.error('Pattern not found in SQL — check the query field');
    console.log('Looking for: {{ $json.is_duplicate }}');
    console.log('Found in SQL:', oldSql.includes('$json.is_duplicate'));
    return;
  }

  logNode.parameters.query = newSql;
  console.log('Updated is_duplicate to use EXISTS subquery.');

  const { binaryMode, timeSavedMode, availableInMCP, ...cleanSettings } = wf.settings || {};
  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: cleanSettings, staticData: wf.staticData || null };

  const updated = await req('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, payload);
  if (updated.message) { console.error('PUT failed:', updated.message); return; }

  await req('POST', `/api/v1/workflows/${WORKFLOW_ID}/activate`, {});

  // Verify
  const verify = await req('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  const verifyNode = verify.nodes.find(n => n.id === 'node_log_postgres');
  const hasExists = verifyNode.parameters.query.includes('SELECT EXISTS');
  console.log('Verified EXISTS subquery in SQL:', hasExists);
  console.log('Done.');
}

run().catch(console.error);
