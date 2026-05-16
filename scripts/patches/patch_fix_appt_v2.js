const http = require('http');

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1N2FhMTMyNS1mODM2LTRmOGItYTk2NC02NDA4NjJlMTQxZjYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNzNlMmRjMTgtMzU5MS00ZjljLWIyYjYtMzZhZjdlNjYwYzViIiwiaWF0IjoxNzc4Mjk1NDUxLCJleHAiOjE3ODA4MTU2MDB9.X7T72Ph9Hv1qY_I8bGB2KnFtmdJ18wVdk6rDiwSjJ9U';
const WORKFLOW_ID = 'muVXGTx7suWyjaiT';

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

const $ = String.fromCharCode(36);

const FIXED_VALIDATE_CODE = `const data = ${$}input.first().json;
const appt = { ...data.appt };
appt.flags = Array.isArray(appt.flags) ? [...appt.flags] : [];
const errors = [];
const warnings = [];
const CONFIG = appt._config || {};

const isInquiry = appt.intent === 'inquiry';

if (!appt.contact_email) errors.push('contact_email is required');

// requested_time required for book/reschedule/cancel — optional for inquiry
if (!appt.requested_time && !isInquiry) {
  errors.push('requested_time is required — format: ISO 8601 e.g. 2026-05-15T14:00:00Z');
}

if (appt.requested_time) {
  const reqMs = new Date(appt.requested_time).getTime();
  const minMs = Date.now() + (CONFIG.min_advance_hours || 2) * 3600000;
  const maxMs = Date.now() + (CONFIG.max_advance_days || 90) * 86400000;
  if (reqMs < minMs) errors.push('Must book at least ' + (CONFIG.min_advance_hours || 2) + ' hours in advance');
  if (reqMs > maxMs) errors.push('Cannot book more than ' + (CONFIG.max_advance_days || 90) + ' days out');

  // Business hours: soft flag only — outside hours routes to pending_review, not rejection
  const days = ['sun','mon','tue','wed','thu','fri','sat'];
  const bh = CONFIG.business_hours || {};
  const reqDate = new Date(appt.requested_time);
  const dayKey = days[reqDate.getUTCDay()];
  const dayHours = bh[dayKey];
  if (dayHours === null || dayHours === undefined) {
    warnings.push('Requested day is outside standard business days');
    appt.flags.push('outside_business_hours');
  } else if (dayHours) {
    const reqHr = reqDate.getUTCHours() + reqDate.getUTCMinutes() / 60;
    const [oh, om] = dayHours.open.split(':').map(Number);
    const [ch, cm] = dayHours.close.split(':').map(Number);
    if (reqHr < oh + om/60 || reqHr >= ch + cm/60) {
      warnings.push('Requested time is outside standard business hours (' + dayHours.open + '-' + dayHours.close + ' UTC)');
      appt.flags.push('outside_business_hours');
    }
  }
}

if (appt.urgency_level === 'urgent') appt.flags.push('urgent_request');

if (errors.length > 0) {
  appt.validation_passed = false;
  appt.validation_errors = errors;
  appt.status = 'rejected';
} else {
  appt.validation_passed = true;
  appt.validation_warnings = warnings;
}
return [{ json: { appt, raw_payload: data.raw_payload } }];`;

const FIXED_DECISION_CODE = `const data = ${$}input.first().json;
const appt = { ...data.appt };
appt.flags = Array.isArray(appt.flags) ? [...appt.flags] : [];
const cfg = appt._config || {};
const autoSources = cfg.auto_confirm_sources || ['internal','crm','staff'];

let autoConfirm = false, reason = '';

if (autoSources.includes(appt.source_type)) {
  autoConfirm = true; reason = 'trusted_source:' + appt.source_type;
} else if (appt.intent_confidence >= 0.90 && appt.urgency_level !== 'urgent') {
  autoConfirm = true; reason = 'high_confidence_booking';
} else {
  autoConfirm = false; reason = 'standard_review';
}

// Urgent always gets staff review regardless of source
if (appt.urgency_level === 'urgent' && cfg.urgent_review_required !== false) {
  autoConfirm = false; reason = 'urgent_requires_staff_review';
  appt.flags.push('urgent_staff_review');
}

// Outside business hours -> staff review
if (appt.flags.includes('outside_business_hours')) {
  autoConfirm = false;
  reason = reason === 'trusted_source:' + appt.source_type ? reason : 'outside_business_hours_requires_review';
  if (!appt.flags.includes('hours_review')) appt.flags.push('hours_review');
}

appt.auto_confirmed = autoConfirm;
appt.scheduling_decision = { auto_confirm: autoConfirm, reason, decided_at: new Date().toISOString() };
return [{ json: { appt, raw_payload: data.raw_payload } }];`;

async function run() {
  console.log('Fetching workflow...');
  const wf = await req('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  if (!wf.nodes) { console.error('Failed to fetch workflow:', JSON.stringify(wf).substring(0,200)); return; }

  const validateNode = wf.nodes.find(n => n.id === 'n_validate');
  const decisionNode = wf.nodes.find(n => n.id === 'n_decision');

  console.log('Current validate first line:', validateNode.parameters.jsCode.split('\n')[0]);

  validateNode.parameters.jsCode = FIXED_VALIDATE_CODE;
  decisionNode.parameters.jsCode = FIXED_DECISION_CODE;

  // n8n PUT only accepts specific fields — strip read-only props
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || {},
    staticData: wf.staticData || null
  };

  console.log('PUTting workflow...');
  const updated = await req('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, payload);
  if (updated.message) { console.error('PUT failed:', updated.message); return; }
  console.log('Workflow updated. Node count:', updated.nodes && updated.nodes.length);

  // Verify the change was saved
  const verify = await req('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  const verifyNode = verify.nodes.find(n => n.id === 'n_validate');
  const hasInquiry = verifyNode.parameters.jsCode.includes('isInquiry');
  console.log('Verify — isInquiry in code:', hasInquiry);

  await req('POST', `/api/v1/workflows/${WORKFLOW_ID}/activate`, {});
  console.log('Done.');
}

run().catch(console.error);
