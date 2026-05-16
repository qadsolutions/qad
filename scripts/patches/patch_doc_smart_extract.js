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

// Simplified Ollama prompt — just classify, do not extract fields.
// llama3.2 is 3.2B — it can classify with keyword hints but not reliably extract structured data.
const OLLAMA_BODY_SIMPLE = `{
  "model": "llama3.2",
  "prompt": "Classify this document into exactly one category. Read the document carefully before deciding.\\n\\nDOCUMENT:\\nFilename: {{ ${$}json.doc.file_name }}\\nSender: {{ ${$}json.doc.sender }}\\nSubject: {{ ${$}json.doc.subject }}\\n{{ (${$}json.doc.document_text || '').substring(0, 2000) }}\\n\\nDECISION RULES — match the FIRST rule that applies to the document content:\\n- Contains 'INVOICE', 'Invoice Number', 'Amount Due', 'Bill To', 'INV-' → invoice\\n- Contains 'REFERRAL', 'Patient', 'Diagnosis Code', 'NPI', 'Referring Physician' → referral\\n- Contains 'NON-DISCLOSURE', 'NDA', 'AGREEMENT', 'shall not disclose', 'confidentiality' → contract\\n- Contains 'RECEIPT', 'Transaction', 'Total Paid', 'Purchase' → receipt\\n- Contains 'INTAKE', 'Client Intake', 'Patient Intake', 'service requested' → intake_form\\n- Contains 'COURT', 'CASE NO', 'PLAINTIFF', 'DEFENDANT', 'MOTION', 'ORDER' → court_document\\n- Contains 'LICENSE', 'PASSPORT', 'DRIVERS LICENSE', 'Date of Expiry' → id_document\\n- Contains 'W-2', '1099', 'TAX RETURN', 'FORM 1040', 'TAXABLE INCOME' → tax_document\\n- Contains 'PURCHASE AGREEMENT', 'ESCROW', 'REAL ESTATE', 'CLOSING' → real_estate\\n- Contains 'Dear', 'Sincerely', 'To Whom It May Concern', 'RE:' → correspondence\\n- None of the above → unknown\\n\\nReturn ONLY this JSON (no explanation, no markdown):\\n{\\"classification_label\\": \\"invoice\\", \\"confidence\\": 0.95, \\"reasoning\\": \\"one sentence\\"}",
  "stream": false,
  "format": "json"
}`;

// Parse & Route — AI for classification only.
// Field extraction is done in code using regex patterns (reliable for all document types).
const PARSE_ROUTE_CODE = [
  `const ollamaData = ${$}input.first().json;`,
  `const prevData = ${$}('Validation Gate').first().json;`,
  `const doc = { ...prevData.doc };`,
  `doc.flags = Array.isArray(doc.flags) ? [...doc.flags] : [];`,
  ``,
  `// Carry forward extraction flags`,
  `try {`,
  `  const extracted = ${$}('Extract Text').first().json;`,
  `  if (extracted && extracted.doc) {`,
  `    doc.document_text = extracted.doc.document_text || doc.document_text;`,
  `    doc.flags = [...new Set([...doc.flags, ...(extracted.doc.flags || [])])];`,
  `  }`,
  `} catch(e) {}`,
  ``,
  `const text = (doc.document_text || '').toLowerCase();`,
  `const rawText = doc.document_text || '';`,
  ``,
  `const VALID_LABELS = ['invoice','contract','intake_form','referral','receipt',`,
  `  'court_document','id_document','tax_document','real_estate','correspondence','unknown'];`,
  ``,
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
  `// ── Step 1: AI Classification ──────────────────────────────────────────`,
  `const ollamaRaw = ollamaData.response || null;`,
  `let label = 'unknown';`,
  `let confidence = 0;`,
  `let aiSuccess = false;`,
  `let reasoning = '';`,
  ``,
  `try {`,
  `  if (!ollamaRaw || ollamaData.error) throw new Error('Ollama unavailable');`,
  `  const parsed = typeof ollamaRaw === 'string' ? JSON.parse(ollamaRaw) : ollamaRaw;`,
  `  const rawLabel = (parsed.classification_label || '').toLowerCase().trim().replace(/[^a-z_]/g, '');`,
  `  const rawConf = parsed.confidence;`,
  `  label = VALID_LABELS.includes(rawLabel) ? rawLabel : 'unknown';`,
  `  confidence = Math.min(1, Math.max(0, typeof rawConf === 'number' ? rawConf : (parseFloat(rawConf) || 0)));`,
  `  reasoning = parsed.reasoning || '';`,
  `  doc.ai_model_used = 'llama3.2';`,
  `  doc.ai_model_source = 'ollama_local';`,
  `  doc.ai_fallback_used = false;`,
  `  aiSuccess = true;`,
  `} catch(e) {`,
  `  // Hint fallback`,
  `  const hint = (doc.document_class_hint || '').toLowerCase();`,
  `  if (VALID_LABELS.includes(hint)) { label = hint; reasoning = 'Used upstream hint.'; }`,
  `  doc.ai_model_used = null;`,
  `  doc.ai_model_source = 'fallback';`,
  `  doc.ai_fallback_used = true;`,
  `  doc.flags.push('ai_fallback_triggered');`,
  `}`,
  ``,
  `// ── Step 2: Code-based field extraction (reliable for all types) ────────`,
  `function extract(pattern, src, group) {`,
  `  try { const m = (src || '').match(pattern); return m ? (m[group || 1] || '').trim() || null : null; } catch(e) { return null; }`,
  `}`,
  ``,
  `let extractedFields = {};`,
  ``,
  `if (label === 'invoice') {`,
  `  extractedFields = {`,
  `    invoice_number: extract(/(?:invoice\\s*#?|INV-?)([\\w-]+)/i, rawText),`,
  `    vendor_name: extract(/(?:from|vendor|company|billed by)[:\\s]+([A-Z][\\w\\s,\\.]+?)(?:\\n|\\r|<|,|$)/im, rawText) || extract(/^([A-Z][A-Z\\s]+(?:LLC|Inc|Corp|Co)\\.?)\\s*$/m, rawText),`,
  `    invoice_date: extract(/(?:invoice date|date)[:\\s]+(\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{1,2},?\\s+\\d{4})/i, rawText),`,
  `    due_date: extract(/due\\s*(?:date|by|on)[:\\s]+(\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{1,2},?\\s+\\d{4})/i, rawText),`,
  `    total_amount: extract(/(?:total|amount due|balance due|grand total)[:\\s]*\\$?([\\d,]+\\.\\d{2})/i, rawText),`,
  `    currency: extract(/\\b(USD|EUR|GBP|CAD|AUD)\\b/, rawText) || 'USD',`,
  `    payment_terms: extract(/payment terms[:\\s]+([\\w\\s]+?)(?:\\n|\\r|$)/i, rawText)`,
  `  };`,
  `} else if (label === 'referral') {`,
  `  extractedFields = {`,
  `    patient_name: extract(/patient\\s*(?:name)?[:\\s]+([A-Za-z]+ [A-Za-z]+)/i, rawText),`,
  `    date_of_birth: extract(/(?:date of birth|dob|d\\.o\\.b)[:\\s]+(\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4})/i, rawText),`,
  `    referring_physician: extract(/referring\\s*(?:physician|doctor|provider)?[:\\s]+(?:Dr\\.?\\s+)?([A-Za-z]+ [A-Za-z]+(?:,\\s*M\\.?D\\.?)?)/i, rawText),`,
  `    npi: extract(/(?:NPI)[:\\s]+([0-9]{10})/i, rawText),`,
  `    diagnosis_code: extract(/(?:diagnosis|ICD)[:\\s]+([A-Z]\\d{2,3}(?:\\.\\d+)?)/i, rawText),`,
  `    diagnosis_description: extract(/(?:diagnosis|condition)[:\\s]+([A-Za-z][\\w\\s,]+?)(?:\\n|\\r|$)/i, rawText),`,
  `    authorization_number: extract(/(?:auth(?:orization)?\\s*(?:number|#|no)[:\\s]+)([\\w-]+)/i, rawText),`,
  `    urgency: extract(/(?:urgency|priority)[:\\s]+([\\w]+)/i, rawText) || 'routine'`,
  `  };`,
  `} else if (label === 'contract') {`,
  `  extractedFields = {`,
  `    contract_type: extract(/(?:agreement|contract) type[:\\s]+([\\w\\s]+)/i, rawText) || extract(/^(NON-DISCLOSURE AGREEMENT|SERVICE AGREEMENT|PURCHASE AGREEMENT|NDA)/im, rawText),`,
  `    party_a: extract(/between\\s+([A-Za-z][\\w\\s,\\.]+?)(?:,|and\\b)/i, rawText),`,
  `    party_b: extract(/and\\s+([A-Za-z][\\w\\s,\\.]+?)(?:,|\\.|\\n)/i, rawText),`,
  `    effective_date: extract(/(?:effective|dated?|entered into)\\s+(?:as of\\s+)?([A-Za-z]+ \\d{1,2},?\\s+\\d{4}|\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4})/i, rawText),`,
  `    governing_law: extract(/governing\\s*law[:\\s]+(?:State of\\s+)?([A-Za-z]+)/i, rawText),`,
  `    term_years: extract(/(\\d+)\\s+years?\\s+(?:from|term)/i, rawText)`,
  `  };`,
  `} else if (label === 'receipt') {`,
  `  extractedFields = {`,
  `    merchant_name: extract(/^([A-Z][\\w\\s]+)\\s*$/m, rawText),`,
  `    transaction_date: extract(/(?:date|transaction date)[:\\s]+(\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4})/i, rawText),`,
  `    total_amount: extract(/(?:total|amount)[:\\s]*\\$?([\\d,]+\\.\\d{2})/i, rawText),`,
  `    currency: extract(/\\b(USD|EUR|GBP|CAD|AUD)\\b/, rawText) || 'USD',`,
  `    payment_method: extract(/(?:paid by|payment method|card)[:\\s]+([\\w\\s]+?)(?:\\n|\\r|$)/i, rawText)`,
  `  };`,
  `} else if (label === 'court_document') {`,
  `  extractedFields = {`,
  `    case_number: extract(/(?:case\\s*(?:no|number|#))[:\\s]+([\\w-]+)/i, rawText),`,
  `    court_name: extract(/(?:court of|superior court|district court)[\\s]+([A-Za-z\\s]+?)(?:\\n|\\r|$)/i, rawText),`,
  `    filing_date: extract(/(?:filed|filing date)[:\\s]+(\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4})/i, rawText),`,
  `    document_type: extract(/^(MOTION|ORDER|COMPLAINT|SUMMONS|JUDGMENT|NOTICE|PETITION)/im, rawText)`,
  `  };`,
  `} else if (label === 'tax_document') {`,
  `  extractedFields = {`,
  `    form_type: extract(/\\b(W-?2|1099-?[A-Z]*|1040|1065|1120|990)\\b/i, rawText),`,
  `    tax_year: extract(/(?:tax year|year)[:\\s]+(\\d{4})/i, rawText) || extract(/\\b(20\\d{2})\\b/, rawText),`,
  `    taxpayer_name: extract(/employee[:\\s]+([A-Za-z]+ [A-Za-z]+)/i, rawText)`,
  `  };`,
  `} else if (label === 'real_estate') {`,
  `  extractedFields = {`,
  `    property_address: extract(/(?:property address|premises|located at)[:\\s]+([\\d][\\w\\s,\\.]+?)(?:\\n|\\r|$)/i, rawText),`,
  `    purchase_price: extract(/(?:purchase price|sale price)[:\\s]*\\$?([\\d,]+(?:\\.\\d{2})?)/i, rawText),`,
  `    closing_date: extract(/(?:closing date|close of escrow)[:\\s]+(\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4}|[A-Za-z]+ \\d{1,2},?\\s+\\d{4})/i, rawText)`,
  `  };`,
  `} else if (label === 'id_document') {`,
  `  extractedFields = {`,
  `    id_type: extract(/\\b(PASSPORT|DRIVER.?S LICENSE|STATE ID|NATIONAL ID)\\b/i, rawText),`,
  `    id_number: extract(/(?:license\\s*no|id\\s*no|document\\s*no|passport\\s*no)[:\\s]+([A-Z0-9]+)/i, rawText),`,
  `    full_name: extract(/(?:name|surname)[:\\s]+([A-Za-z]+ [A-Za-z]+)/i, rawText),`,
  `    expiry_date: extract(/(?:expiry|expires|valid through)[:\\s]+(\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4})/i, rawText)`,
  `  };`,
  `} else if (label === 'correspondence') {`,
  `  extractedFields = {`,
  `    sender_name: extract(/(?:from|sincerely|regards)[,:\\s]+([A-Za-z]+ [A-Za-z]+)/i, rawText),`,
  `    document_date: extract(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4})/im, rawText),`,
  `    subject: extract(/(?:re|subject)[:\\s]+([^\\n]+)/i, rawText)`,
  `  };`,
  `} else if (label === 'intake_form') {`,
  `  extractedFields = {`,
  `    client_name: extract(/(?:name|client name|patient name)[:\\s]+([A-Za-z]+ [A-Za-z]+)/i, rawText),`,
  `    contact_email: extract(/([\\w.+-]+@[\\w-]+\\.[\\w.]+)/, rawText),`,
  `    contact_phone: extract(/(\\(?\\d{3}\\)?[\\s.-]\\d{3}[\\s.-]\\d{4})/, rawText),`,
  `    service_requested: extract(/(?:service requested|reason for visit|chief complaint)[:\\s]+([^\\n]+)/i, rawText)`,
  `  };`,
  `}`,
  ``,
  `// Remove null-only extractions to keep output clean`,
  `const cleaned = {};`,
  `Object.entries(extractedFields).forEach(([k, v]) => { if (v !== null && v !== undefined) cleaned[k] = v; });`,
  `extractedFields = Object.keys(cleaned).length > 0 ? cleaned : extractedFields;`,
  ``,
  `// ── Step 3: Enforce confidence thresholds ─────────────────────────────`,
  `let downstreamAction, reviewRequired = false;`,
  `if (!aiSuccess) {`,
  `  downstreamAction = 'human_review'; reviewRequired = true;`,
  `} else if (label === 'unknown' || confidence < 0.50) {`,
  `  downstreamAction = 'human_review'; reviewRequired = true; doc.flags.push('low_confidence_review');`,
  `} else if (confidence < 0.80) {`,
  `  downstreamAction = 'human_review'; reviewRequired = true; doc.flags.push('moderate_confidence_review');`,
  `} else {`,
  `  downstreamAction = 'auto_process';`,
  `}`,
  ``,
  `// Auto-escalate court documents and urgent items`,
  `if (label === 'court_document' && aiSuccess) {`,
  `  downstreamAction = 'escalate'; reviewRequired = true; doc.flags.push('auto_escalated_court_doc');`,
  `}`,
  ``,
  `const routingDestination = ROUTING_MAP[label] || 'human_review_queue';`,
  `const filingTarget = label !== 'unknown'`,
  `  ? label + '/' + new Date().getFullYear() + '/' + String(new Date().getMonth() + 1).padStart(2, '0')`,
  `  : 'unclassified/pending';`,
  ``,
  `doc.classification_label = label;`,
  `doc.confidence_score = confidence;`,
  `doc.routing_destination = routingDestination;`,
  `doc.filing_target = filingTarget;`,
  `doc.downstream_action = downstreamAction;`,
  `doc.review_required = reviewRequired;`,
  `doc.extracted_fields = extractedFields;`,
  `doc.classification_result = { label, confidence, routing_destination: routingDestination, filing_target: filingTarget, reasoning, ai_success: aiSuccess };`,
  `doc.processed_at = new Date().toISOString();`,
  ``,
  `return [{ json: { doc, raw_payload: prevData.raw_payload } }];`
].join('\n');

async function main() {
  console.log('Fetching workflow...');
  const wf = await req('GET', `/api/v1/workflows/${WF_ID}`);

  // Fix 1: Simplified Ollama prompt (classification only)
  const ollamaNode = wf.nodes.find(n => n.name === 'Ollama Classify & Extract');
  ollamaNode.parameters.body = OLLAMA_BODY_SIMPLE;
  console.log('Updated Ollama body (simplified classification prompt).');

  // Fix 2: Rename Parse node to avoid confusion and swap code
  const parseNode = wf.nodes.find(n => n.name === 'Parse & Route');
  parseNode.parameters.jsCode = PARSE_ROUTE_CODE;
  console.log('Updated Parse & Route (code-based field extraction added).');

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
