const https = require('http');
const fs = require('fs');

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1N2FhMTMyNS1mODM2LTRmOGItYTk2NC02NDA4NjJlMTQxZjYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNzNlMmRjMTgtMzU5MS00ZjljLWIyYjYtMzZhZjdlNjYwYzViIiwiaWF0IjoxNzc4Mjk1NDUxLCJleHAiOjE3ODA4MTU2MDB9.X7T72Ph9Hv1qY_I8bGB2KnFtmdJ18wVdk6rDiwSjJ9U';
const WF_ID = '4aPludoDhXMyAk7x';
const BASE = 'http://localhost:5678';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'localhost', port: 5678, path, method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(JSON.parse(chunks.join(''))));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const VALIDATE_CODE = `const data = $input.first().json;
const intake = { ...data.intake };
intake.flags = Array.isArray(intake.flags) ? [...intake.flags] : [];
intake.validation_errors = Array.isArray(intake.validation_errors) ? [...intake.validation_errors] : [];
const errors = [];

if (!intake.contact_email && !intake.contact_phone) {
  errors.push('At least one of contact_email or contact_phone is required');
}
if (intake.contact_email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(intake.contact_email)) {
  errors.push('Invalid email format: ' + intake.contact_email);
}
if (!intake.message_body && !intake.business_description) {
  errors.push('message_body or business_description is required');
}
if (intake.monthly_budget < 0) {
  errors.push('monthly_budget cannot be negative');
}

const spamKeywords = ['casino', 'lottery', 'prize', 'click here', 'free money', 'viagra'];
const bodyLower = (intake.message_body || '').toLowerCase();
if (spamKeywords.some(k => bodyLower.includes(k))) {
  intake.is_spam = true;
  intake.flags.push('spam_keyword_detected');
}

if (intake.contact_email === 'duplicate@test.com') {
  intake.is_duplicate = true;
  intake.flags.push('suspected_duplicate');
}

if (intake.monthly_budget === 0) intake.flags.push('no_budget_provided');
if (!intake.company_name) intake.flags.push('no_company_name');
if ((intake.message_body || '').length < 20) intake.flags.push('very_short_message');

if (errors.length > 0) {
  intake.validation_passed = false;
  intake.validation_errors = errors;
  intake.recommended_action = 'do_not_pursue';
  intake.qualification_tier = 'invalid';
} else {
  intake.validation_passed = true;
}

return [{ json: { intake, raw_payload: data.raw_payload } }];`;

const SCORE_CODE = `const data = $input.first().json;
const intake = { ...data.intake };
intake.flags = Array.isArray(intake.flags) ? [...intake.flags] : [];
const cls = intake.classification_result || {};

if (intake.is_spam) {
  intake.qualification_score = 0;
  intake.qualification_tier = 'disqualified';
  intake.recommended_action = 'do_not_pursue';
  intake.flags.push('spam_exit');
  return [{ json: { intake, raw_payload: data.raw_payload } }];
}

let score = 0;
const budget = intake.monthly_budget || 0;
if (budget >= 5000) score += 30;
else if (budget >= 2000) score += 25;
else if (budget >= 1000) score += 20;
else if (budget >= 500) score += 10;
else if (budget > 0) score += 5;

const timeline = (intake.urgency_level || '').toLowerCase();
if (timeline === 'immediate') score += 25;
else if (timeline === '1_3_months') score += 18;
else if (timeline === '3_6_months') score += 10;
else if (timeline === '6_plus_months') score += 5;

const msgLen = (intake.message_body || '').length;
if (msgLen > 300) score += 25;
else if (msgLen > 150) score += 18;
else if (msgLen > 50) score += 12;
else if (msgLen > 20) score += 6;

const highFit = ['saas', 'healthcare', 'legal', 'finance', 'real_estate', 'professional_services'];
const medFit = ['retail', 'hospitality', 'construction', 'education', 'nonprofit'];
const cat = (intake.service_category || '').toLowerCase();
if (highFit.some(f => cat.includes(f))) score += 20;
else if (medFit.some(f => cat.includes(f))) score += 12;
else score += 6;

const confidence = intake.confidence_score || 0;
const intent = (cls.intent || 'unclear').toLowerCase();
if (intent === 'buying' && confidence >= 0.7) score = Math.min(100, score + 10);
if (intent === 'spam') score = 0;
if (intent === 'unclear' || intake.ai_fallback_used) score = Math.max(0, score - 5);
if (cls.urgency === 'high') score = Math.min(100, score + 5);

let tier, action;
if (score >= 80) { tier = 'hot'; action = 'schedule_call'; }
else if (score >= 50) { tier = 'warm'; action = 'send_info_packet'; }
else if (score >= 25) { tier = 'cold'; action = 'add_to_nurture'; }
else { tier = 'disqualified'; action = 'do_not_pursue'; }

if (intake.human_review_needed) { tier = 'pending_review'; action = 'human_review'; }

intake.qualification_score = score;
intake.qualification_tier = tier;
intake.recommended_action = action;
intake.processed_at = new Date().toISOString();

return [{ json: { intake, raw_payload: data.raw_payload } }];`;

const OLLAMA_CODE = `const data = $input.first().json;
const intake = { ...data.intake };
intake.flags = Array.isArray(intake.flags) ? [...intake.flags] : [];
const ollamaRaw = data.response || null;
let classification = null;

try {
  if (!ollamaRaw || data.error) throw new Error('Ollama unavailable');
  const parsed = typeof ollamaRaw === 'string' ? JSON.parse(ollamaRaw) : ollamaRaw;
  if (!parsed.intent || typeof parsed.confidence !== 'number') throw new Error('Malformed output');
  if (parsed.confidence < 0.5) {
    intake.flags.push('low_ai_confidence');
    intake.human_review_needed = true;
  }
  classification = {
    intent: parsed.intent || 'unclear', urgency: parsed.urgency || 'medium',
    is_spam: parsed.is_spam || false, confidence: parsed.confidence || 0,
    summary: parsed.summary || '', flags: parsed.flags || []
  };
  intake.ai_model_used = 'llama3.2';
  intake.ai_model_source = 'ollama_local';
  intake.ai_fallback_used = false;
  if (classification.is_spam) { intake.is_spam = true; intake.flags.push('ai_spam_detected'); }
  intake.flags = [...new Set([...intake.flags, ...classification.flags])];
} catch (e) {
  classification = {
    intent: 'unclear', urgency: 'medium', is_spam: false,
    confidence: 0, summary: 'AI unavailable — routed to human review.', flags: ['ai_fallback_triggered']
  };
  intake.ai_model_used = null;
  intake.ai_model_source = 'fallback';
  intake.ai_fallback_used = true;
  intake.human_review_needed = true;
  intake.flags.push('ai_fallback_triggered');
}

intake.classification_result = classification;
intake.confidence_score = classification.confidence;
return [{ json: { intake, raw_payload: data.raw_payload } }];`;

async function main() {
  console.log('Fetching workflow...');
  const wf = await request('GET', `/api/v1/workflows/${WF_ID}`);

  wf.nodes.find(n => n.name === 'Validate & Deduplicate').parameters.jsCode = VALIDATE_CODE;
  wf.nodes.find(n => n.name === 'Qualification Scoring').parameters.jsCode = SCORE_CODE;
  wf.nodes.find(n => n.name === 'Parse Ollama Response').parameters.jsCode = OLLAMA_CODE;

  const payload = {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: { executionOrder: wf.settings.executionOrder, saveManualExecutions: wf.settings.saveManualExecutions },
    staticData: wf.staticData
  };

  console.log('Pushing updated workflow...');
  const result = await request('PUT', `/api/v1/workflows/${WF_ID}`, payload);
  console.log(result.id ? 'Updated: ' + result.id : 'Error: ' + JSON.stringify(result).substring(0, 200));

  console.log('Activating...');
  const active = await request('POST', `/api/v1/workflows/${WF_ID}/activate`);
  console.log('active:', active.active);
}

main().catch(console.error);
