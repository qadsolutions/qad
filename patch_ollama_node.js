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

// Note: $input and $() are n8n built-ins — they must appear literally in the string
// so we build the code string with explicit $ characters via String.fromCharCode(36)
const $ = String.fromCharCode(36);

const OLLAMA_PARSE_CODE = [
  `// Ollama response is in ${$}input — intake came from the node BEFORE Ollama`,
  `const ollamaData = ${$}input.first().json;`,
  `const prevData = ${$}('Validation Gate').first().json;`,
  `const intake = { ...prevData.intake };`,
  `intake.flags = Array.isArray(intake.flags) ? [...intake.flags] : [];`,
  ``,
  `const ollamaRaw = ollamaData.response || null;`,
  `let classification = null;`,
  ``,
  `try {`,
  `  if (!ollamaRaw || ollamaData.error) throw new Error('Ollama unavailable');`,
  `  const parsed = typeof ollamaRaw === 'string' ? JSON.parse(ollamaRaw) : ollamaRaw;`,
  `  if (!parsed.intent || typeof parsed.confidence !== 'number') throw new Error('Malformed output');`,
  `  if (parsed.confidence < 0.5) {`,
  `    intake.flags.push('low_ai_confidence');`,
  `    intake.human_review_needed = true;`,
  `  }`,
  `  classification = {`,
  `    intent: parsed.intent || 'unclear',`,
  `    urgency: parsed.urgency || 'medium',`,
  `    is_spam: parsed.is_spam || false,`,
  `    confidence: parsed.confidence || 0,`,
  `    summary: parsed.summary || '',`,
  `    flags: parsed.flags || []`,
  `  };`,
  `  intake.ai_model_used = 'llama3.2';`,
  `  intake.ai_model_source = 'ollama_local';`,
  `  intake.ai_fallback_used = false;`,
  `  if (classification.is_spam) { intake.is_spam = true; intake.flags.push('ai_spam_detected'); }`,
  `  intake.flags = [...new Set([...intake.flags, ...classification.flags])];`,
  `} catch (e) {`,
  `  classification = {`,
  `    intent: 'unclear', urgency: 'medium', is_spam: false,`,
  `    confidence: 0, summary: 'AI unavailable — routed to human review.', flags: ['ai_fallback_triggered']`,
  `  };`,
  `  intake.ai_model_used = null;`,
  `  intake.ai_model_source = 'fallback';`,
  `  intake.ai_fallback_used = true;`,
  `  intake.human_review_needed = true;`,
  `  intake.flags.push('ai_fallback_triggered');`,
  `}`,
  ``,
  `intake.classification_result = classification;`,
  `intake.confidence_score = classification.confidence;`,
  `return [{ json: { intake, raw_payload: prevData.raw_payload } }];`
].join('\n');

async function main() {
  console.log('Fetching workflow...');
  const wf = await req('GET', `/api/v1/workflows/${WF_ID}`);

  const node = wf.nodes.find(n => n.name === 'Parse Ollama Response');
  node.parameters.jsCode = OLLAMA_PARSE_CODE;

  // Verify $ signs are present
  const hasInput = OLLAMA_PARSE_CODE.includes('$input');
  const hasNodeRef = OLLAMA_PARSE_CODE.includes("$('Validation Gate')");
  console.log('$input present:', hasInput);
  console.log('$() reference present:', hasNodeRef);

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
