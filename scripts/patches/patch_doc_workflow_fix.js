const http = require('http');

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1N2FhMTMyNS1mODM2LTRmOGItYTk2NC02NDA4NjJlMTQxZjYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNzNlMmRjMTgtMzU5MS00ZjljLWIyYjYtMzZhZjdlNjYwYzViIiwiaWF0IjoxNzc4Mjk1NDUxLCJleHAiOjE3ODA4MTU2MDB9.X7T72Ph9Hv1qY_I8bGB2KnFtmdJ18wVdk6rDiwSjJ9U';
const WF_ID = 'O1e31Q9dMP4I86Lr';

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

// FIX 1: Ollama body — no leading `=`, use template syntax so {{ }} vars are evaluated
// FIX 3: Include document_class_hint in the prompt
const OLLAMA_BODY_FIXED = `{
  "model": "llama3.2",
  "prompt": "You are a document classification AI. Analyze this document and return ONLY a valid JSON object with no markdown, no explanation.\\n\\nDocument Metadata:\\nFile: {{ ${$}json.doc.file_name }}\\nType: {{ ${$}json.doc.file_type }}\\nSender: {{ ${$}json.doc.sender }}\\nSubject: {{ ${$}json.doc.subject }}\\n{{ ${$}json.doc.document_class_hint ? 'Classification Hint from upstream: ' + ${$}json.doc.document_class_hint : '' }}\\n\\nDocument Text (first 2000 chars):\\n{{ (${$}json.doc.document_text || '[No text available]').substring(0, 2000) }}\\n\\nValid classification labels: invoice, contract, intake_form, referral, receipt, court_document, id_document, tax_document, real_estate, correspondence, unknown\\n\\nReturn exactly this JSON structure:\\n{\\"classification_label\\": \\"invoice\\", \\"confidence\\": 0.85, \\"filing_target\\": \\"invoices/vendor\\", \\"extracted_fields\\": {\\"vendor_name\\": null, \\"invoice_number\\": null, \\"total_amount\\": null, \\"due_date\\": null}, \\"summary\\": \\"One sentence description\\", \\"flags\\": []}",
  "stream": false,
  "format": "json"
}`;

// FIX 2: Parse Ollama Response — enforce confidence thresholds, handle document_class_hint fallback
const OLLAMA_PARSE_CODE_FIXED = [
  `const ollamaData = ${$}input.first().json;`,
  `const prevData = ${$}('Validation Gate').first().json;`,
  `const doc = { ...prevData.doc };`,
  `doc.flags = Array.isArray(doc.flags) ? [...doc.flags] : [];`,
  ``,
  `// Carry forward text extraction flags`,
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
  `let aiSuccess = false;`,
  ``,
  `try {`,
  `  if (!ollamaRaw || ollamaData.error) throw new Error('Ollama unavailable');`,
  `  const parsed = typeof ollamaRaw === 'string' ? JSON.parse(ollamaRaw) : ollamaRaw;`,
  `  const label = parsed.classification_label;`,
  `  const validLabels = ['invoice','contract','intake_form','referral','receipt','court_document','id_document','tax_document','real_estate','correspondence','unknown'];`,
  `  if (!label) throw new Error('No classification_label in response');`,
  ``,
  `  // Normalize confidence — Ollama may return string or number`,
  `  const rawConf = parsed.confidence;`,
  `  const confidence = typeof rawConf === 'number' ? rawConf : parseFloat(rawConf) || 0;`,
  ``,
  `  // Enforce confidence thresholds (spec: >=0.80 auto, 0.50-0.79 review, <0.50 human review)`,
  `  let downstreamAction;`,
  `  let reviewRequired = false;`,
  `  if (!validLabels.includes(label) || label === 'unknown' || confidence < 0.50) {`,
  `    downstreamAction = 'human_review';`,
  `    reviewRequired = true;`,
  `    doc.flags.push('low_ai_confidence');`,
  `  } else if (confidence < 0.80) {`,
  `    downstreamAction = 'human_review';`,
  `    reviewRequired = true;`,
  `    doc.flags.push('moderate_confidence_review');`,
  `  } else {`,
  `    downstreamAction = 'auto_process';`,
  `  }`,
  ``,
  `  // Honor escalation flag from Ollama if explicitly set`,
  `  if (parsed.flags && parsed.flags.includes('escalate')) {`,
  `    downstreamAction = 'escalate';`,
  `    reviewRequired = true;`,
  `  }`,
  ``,
  `  classification = {`,
  `    classification_label: validLabels.includes(label) ? label : 'unknown',`,
  `    confidence: confidence,`,
  `    filing_target: parsed.filing_target || label + '/general',`,
  `    downstream_action: downstreamAction,`,
  `    extracted_fields: parsed.extracted_fields || {},`,
  `    summary: parsed.summary || '',`,
  `    flags: parsed.flags || []`,
  `  };`,
  ``,
  `  doc.ai_model_used = 'llama3.2';`,
  `  doc.ai_model_source = 'ollama_local';`,
  `  doc.ai_fallback_used = false;`,
  `  doc.review_required = reviewRequired;`,
  `  doc.flags = [...new Set([...doc.flags, ...classification.flags])];`,
  `  aiSuccess = true;`,
  ``,
  `} catch(e) {`,
  `  // AI failed — check if there's a hint we can use`,
  `  const hint = doc.document_class_hint;`,
  `  const validLabels = ['invoice','contract','intake_form','referral','receipt','court_document','id_document','tax_document','real_estate','correspondence'];`,
  `  const hintLabel = hint && validLabels.includes(hint.toLowerCase()) ? hint.toLowerCase() : 'unknown';`,
  ``,
  `  classification = {`,
  `    classification_label: hintLabel,`,
  `    confidence: hintLabel !== 'unknown' ? 0.0 : 0,`,
  `    filing_target: hintLabel !== 'unknown' ? hintLabel + '/unverified' : 'review_queue',`,
  `    downstream_action: 'human_review',`,
  `    extracted_fields: {},`,
  `    summary: 'AI classification unavailable — ' + (hintLabel !== 'unknown' ? 'used upstream hint: ' + hintLabel : 'routed to human review.'),`,
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

// FIX 4: Add trigger_workflow to Route by Action switch rules
const ROUTE_PARAMS_FIXED = {
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
      },
      {
        conditions: { options: { caseSensitive: false, leftValue: "", typeValidation: "loose" }, conditions: [{ leftValue: `={{ ${$}json.doc.downstream_action }}`, rightValue: "trigger_workflow", operator: { type: "string", operation: "equals" } }], combinator: "and" },
        renameOutput: true, outputKey: "trigger_workflow"
      }
    ]
  },
  fallbackOutput: "extra"
};

async function main() {
  console.log('Fetching workflow...');
  const wf = await req('GET', `/api/v1/workflows/${WF_ID}`);

  // Fix 1 & 3: Ollama body — template syntax + document_class_hint
  const ollamaNode = wf.nodes.find(n => n.name === 'Ollama Classify & Extract');
  ollamaNode.parameters.body = OLLAMA_BODY_FIXED;
  console.log('Fixed Ollama body template syntax.');

  // Fix 2: Parse Ollama Response — confidence thresholds + hint fallback
  const parseNode = wf.nodes.find(n => n.name === 'Parse Ollama Response');
  parseNode.parameters.jsCode = OLLAMA_PARSE_CODE_FIXED;
  console.log('Fixed Parse Ollama Response with threshold enforcement.');

  // Fix 4: Route by Action — add trigger_workflow rule
  const routeNode = wf.nodes.find(n => n.name === 'Route by Action');
  routeNode.parameters = ROUTE_PARAMS_FIXED;

  // Add a Trigger Workflow node (code stub) wired to output index 3
  // Remove if already exists
  wf.nodes = wf.nodes.filter(n => n.name !== 'Trigger Downstream Workflow');
  const triggerNode = {
    id: 'node_trigger_wf', name: 'Trigger Downstream Workflow', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1760, 640],
    parameters: {
      jsCode: `const doc = ${$}input.first().json.doc;\n// Stub: in production, call a downstream workflow via HTTP or n8n workflow trigger\nconsole.log('trigger_workflow for:', doc.document_id, 'class:', doc.classification_label);\nreturn [{ json: { doc, action_taken: 'trigger_workflow', triggered_at: new Date().toISOString() } }];`
    }
  };
  wf.nodes.push(triggerNode);

  // Wire trigger_workflow output (index 3) from Route by Action to Trigger Downstream Workflow
  wf.connections['Route by Action'] = {
    main: [
      [{ node: 'Auto Process Document', type: 'main', index: 0 }],
      [{ node: 'Human Review Alert', type: 'main', index: 0 }],
      [{ node: 'Escalate Document', type: 'main', index: 0 }],
      [{ node: 'Trigger Downstream Workflow', type: 'main', index: 0 }]
    ]
  };
  wf.connections['Trigger Downstream Workflow'] = {
    main: [[{ node: 'Prepare Log Data', type: 'main', index: 0 }]]
  };
  // Archive Document now comes from fallback — but Switch v3 fallback is "extra" output (index 4 effectively)
  // Archive is connected via the fallback — keep existing Archive Document connection to Prepare Log Data
  console.log('Fixed Route by Action with trigger_workflow rule.');

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
