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

async function main() {
  console.log('Fetching workflow...');
  const wf = await req('GET', `/api/v1/workflows/${WF_ID}`);

  // Fix Webhook Response — use respondWith:json with proper field mapping
  const respNode = wf.nodes.find(n => n.name === 'Webhook Response');
  respNode.parameters = {
    respondWith: 'json',
    responseBody: '={{ $json.intake ? { status: "success", intake_id: $json.intake.intake_id, qualification_tier: $json.intake.qualification_tier, qualification_score: $json.intake.qualification_score, recommended_action: $json.intake.recommended_action, human_review_needed: $json.intake.human_review_needed, flags: $json.intake.flags, processed_at: $json.intake.processed_at } : $json }}',
    options: { responseCode: 200 }
  };

  // Fix Validation Fail Response — same approach
  const failNode = wf.nodes.find(n => n.name === 'Validation Fail Response');
  failNode.parameters = {
    respondWith: 'json',
    responseBody: '={{ { status: "error", error_type: "validation", errors: $json.intake.validation_errors, intake_id: $json.intake.intake_id } }}',
    options: { responseCode: 400 }
  };

  console.log('Nodes found:', !!respNode, !!failNode);

  const payload = {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: {
      executionOrder: wf.settings.executionOrder,
      saveManualExecutions: wf.settings.saveManualExecutions
    },
    staticData: wf.staticData
  };

  const result = await req('PUT', `/api/v1/workflows/${WF_ID}`, payload);
  console.log(result.id ? 'Updated: ' + result.id : 'Error: ' + JSON.stringify(result).substring(0, 200));

  const active = await req('POST', `/api/v1/workflows/${WF_ID}/activate`);
  console.log('active:', active.active);
}

main().catch(console.error);
