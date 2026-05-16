const http = require('http');

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1N2FhMTMyNS1mODM2LTRmOGItYTk2NC02NDA4NjJlMTQxZjYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNzNlMmRjMTgtMzU5MS00ZjljLWIyYjYtMzZhZjdlNjYwYzViIiwiaWF0IjoxNzc4Mjk1NDUxLCJleHAiOjE3ODA4MTU2MDB9.X7T72Ph9Hv1qY_I8bGB2KnFtmdJ18wVdk6rDiwSjJ9U';

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

// Business hours + service config — embedded in Normalize so operators can edit one place
const CONFIG_JSON = JSON.stringify({
  business_hours: {
    mon: { open: '08:00', close: '18:00' },
    tue: { open: '08:00', close: '18:00' },
    wed: { open: '08:00', close: '18:00' },
    thu: { open: '08:00', close: '18:00' },
    fri: { open: '08:00', close: '17:00' },
    sat: { open: '09:00', close: '13:00' },
    sun: null
  },
  service_durations: {
    consultation: 30, initial_visit: 60, follow_up: 15,
    showing: 45, assessment: 90, checkup: 30, default: 60
  },
  buffer_after_minutes: 15,
  min_advance_hours: 2,
  max_advance_days: 90,
  auto_confirm_sources: ['internal', 'crm', 'staff'],
  urgent_review_required: true
});

// ─── NORMALIZE APPOINTMENT ──────────────────────────────────────────────────
const NORMALIZE_CODE = `
const raw = ${$}input.first().json.body || ${$}input.first().json;
const CONFIG = ${CONFIG_JSON};
const now = new Date().toISOString();
const apptId = 'appt_' + Date.now() + '_' + Math.random().toString(36).substr(2,9);
const execId = ${$}execution?.id || 'exec_' + Date.now();

const srcType = raw.source_type || (
  raw.form_id ? 'form' : raw.widget_id ? 'widget' :
  raw.email_thread ? 'email' : raw.crm_id ? 'crm' : 'api'
);

const svcType = (raw.service_type || 'default').toLowerCase();
const durationMin = parseInt(raw.duration_minutes) ||
  CONFIG.service_durations[svcType] || CONFIG.service_durations.default || 60;
const bufferAfter = raw.buffer_after_minutes !== undefined ? parseInt(raw.buffer_after_minutes) : CONFIG.buffer_after_minutes;
const bufferBefore = parseInt(raw.buffer_before_minutes) || 0;

let requestedTime = null, endTime = null;
try {
  if (raw.requested_time) {
    requestedTime = new Date(raw.requested_time).toISOString();
    endTime = new Date(new Date(requestedTime).getTime() + (durationMin + bufferAfter) * 60000).toISOString();
  }
} catch(e) {}

const appt = {
  appointment_id: raw.appointment_id || apptId,
  execution_id: execId,
  workflow_version: 'appointment_scheduling_v1',
  client_id: raw.client_id || 'default',

  request_type: raw.request_type || null,
  source_type: srcType,
  source_channel: raw.source_channel || null,

  contact_name: raw.contact_name || raw.name || null,
  contact_email: (raw.contact_email || raw.email || '').toLowerCase().trim() || null,
  contact_phone: raw.contact_phone || raw.phone || null,

  service_type: svcType,
  appointment_type: raw.appointment_type || raw.type || null,

  requested_time: requestedTime,
  confirmed_time: null,
  end_time: endTime,
  timezone: raw.timezone || 'UTC',
  duration_minutes: durationMin,
  buffer_before_minutes: bufferBefore,
  buffer_after_minutes: bufferAfter,

  assigned_staff: raw.assigned_staff || raw.staff || null,
  calendar_target: raw.calendar_target || 'default',
  location_or_link: raw.location || raw.meeting_link || raw.address || null,

  status: 'pending',
  urgency_level: (raw.urgency_level || raw.urgency || 'normal').toLowerCase(),

  notes: raw.notes || raw.message || raw.description || null,
  consent_flags: raw.consent_flags || {},
  metadata: raw.metadata || {},

  // Will be set by downstream nodes
  intent: null, intent_confidence: 0, intent_source: null,
  availability_checked: false, conflict_detected: false, conflict_details: null,
  alternatives: [], auto_confirmed: false, scheduling_decision: {},
  validation_passed: null, validation_errors: [],
  reminder_sequence: [],
  previous_appointment_id: raw.previous_appointment_id || raw.original_id || null,
  cancel_reason: raw.cancel_reason || null,
  ai_model_used: null, ai_model_source: null, ai_response_time_ms: 0, ai_fallback_used: false,
  error_message: null, flags: [],
  received_at: now, processed_at: null,
  _config: CONFIG
};

return [{ json: { appt, raw_payload: raw } }];
`.trim();

// ─── CLASSIFY INTENT (keyword rules) ───────────────────────────────────────
const CLASSIFY_INTENT_CODE = `
const data = ${$}input.first().json;
const appt = { ...data.appt };
appt.flags = Array.isArray(appt.flags) ? [...appt.flags] : [];

const validIntents = ['book', 'reschedule', 'cancel', 'inquiry'];

// Honour explicit request_type from caller — highest priority
if (appt.request_type && validIntents.includes(appt.request_type.toLowerCase())) {
  appt.intent = appt.request_type.toLowerCase();
  appt.intent_confidence = 1.0;
  appt.intent_source = 'explicit';
  return [{ json: { appt, raw_payload: data.raw_payload } }];
}

// Keyword scan across notes + subject + service type
const txt = ((appt.notes || '') + ' ' + (appt.service_type || '') + ' ' + (appt.appointment_type || '')).toLowerCase();

let intent = null, confidence = 0;
if (/\\b(cancel|cancell|can't make|no longer need|want to cancel|remove my|delete my)/.test(txt)) {
  intent = 'cancel'; confidence = 0.90;
} else if (/\\b(reschedul|move|postpone|push back|change.*time|different (day|time)|new time|can we move|need to move)/.test(txt)) {
  intent = 'reschedule'; confidence = 0.88;
} else if (/\\b(book|schedule|appointment|reserve|set up|need.*appt|make.*appt|sign up|register)/.test(txt)) {
  intent = 'book'; confidence = 0.85;
} else if (/\\b(available|availability|open slot|when.*open|check|do you have|what time)/.test(txt)) {
  intent = 'inquiry'; confidence = 0.80;
} else if (appt.requested_time) {
  intent = 'book'; confidence = 0.55;  // has a time = probably booking
} else {
  intent = null; confidence = 0;
}

appt.intent = intent;
appt.intent_confidence = confidence;
appt.intent_source = 'keyword';
return [{ json: { appt, raw_payload: data.raw_payload } }];
`.trim();

// ─── OLLAMA INTENT BODY (template mode — no leading =) ─────────────────────
const OLLAMA_INTENT_BODY = `{
  "model": "llama3.2",
  "prompt": "You are a scheduling assistant. Classify the intent of this message into one of: book, reschedule, cancel, inquiry.\\n\\nMessage: {{ (${$}json.appt.notes || ${$}json.appt.appointment_type || 'no message provided').substring(0, 500) }}\\n\\nReturn ONLY this JSON (no explanation):\\n{\\"intent\\": \\"book\\", \\"confidence\\": 0.85, \\"reason\\": \\"brief reason\\"}",
  "stream": false,
  "format": "json"
}`;

// ─── PARSE OLLAMA INTENT ────────────────────────────────────────────────────
const PARSE_OLLAMA_INTENT_CODE = [
  `const ollamaData = ${$}input.first().json;`,
  `const prevData = ${$}('Classify Intent').first().json;`,
  `const appt = { ...prevData.appt };`,
  `appt.flags = Array.isArray(appt.flags) ? [...appt.flags] : [];`,
  `const validIntents = ['book', 'reschedule', 'cancel', 'inquiry'];`,
  ``,
  `// If intent was already set with high confidence (explicit or clear keyword), skip AI`,
  `if (appt.intent_confidence >= 0.85) {`,
  `  return [{ json: { appt, raw_payload: prevData.raw_payload } }];`,
  `}`,
  ``,
  `try {`,
  `  const ollamaRaw = ollamaData.response || null;`,
  `  if (!ollamaRaw || ollamaData.error) throw new Error('Ollama unavailable');`,
  `  const parsed = typeof ollamaRaw === 'string' ? JSON.parse(ollamaRaw) : ollamaRaw;`,
  `  const aiIntent = (parsed.intent || '').toLowerCase().trim();`,
  `  const aiConf = Math.min(1, Math.max(0, typeof parsed.confidence === 'number' ? parsed.confidence : parseFloat(parsed.confidence) || 0));`,
  ``,
  `  if (validIntents.includes(aiIntent)) {`,
  `    if (appt.intent === aiIntent) {`,
  `      appt.intent_confidence = Math.min(1, appt.intent_confidence + 0.08);`,
  `      appt.intent_source = 'keyword+ai_consensus';`,
  `    } else {`,
  `      appt.intent = aiIntent;`,
  `      appt.intent_confidence = aiConf;`,
  `      appt.intent_source = 'ai_resolved';`,
  `    }`,
  `    appt.ai_model_used = 'llama3.2';`,
  `    appt.ai_model_source = 'ollama_local';`,
  `    appt.ai_fallback_used = false;`,
  `  }`,
  `} catch(e) {`,
  `  appt.flags.push('ai_intent_fallback');`,
  `  appt.ai_fallback_used = true;`,
  `  appt.ai_model_source = 'fallback';`,
  `}`,
  ``,
  `// Final fallback — default to 'book' if still unresolved`,
  `if (!appt.intent || !validIntents.includes(appt.intent)) {`,
  `  appt.intent = appt.requested_time ? 'book' : 'inquiry';`,
  `  appt.intent_confidence = 0.40;`,
  `  appt.intent_source = 'default_fallback';`,
  `  appt.flags.push('intent_fallback');`,
  `}`,
  ``,
  `return [{ json: { appt, raw_payload: prevData.raw_payload } }];`
].join('\n');

// ─── VALIDATE BOOKING ───────────────────────────────────────────────────────
const VALIDATE_BOOKING_CODE = `
const data = ${$}input.first().json;
const appt = { ...data.appt };
appt.flags = Array.isArray(appt.flags) ? [...appt.flags] : [];
const errors = [];
const CONFIG = appt._config || {};

if (!appt.contact_email) errors.push('contact_email is required');
if (!appt.requested_time) errors.push('requested_time is required — format: ISO 8601 e.g. 2026-05-15T14:00:00Z');

if (appt.requested_time) {
  const reqMs = new Date(appt.requested_time).getTime();
  const minMs = Date.now() + (CONFIG.min_advance_hours || 2) * 3600000;
  const maxMs = Date.now() + (CONFIG.max_advance_days || 90) * 86400000;
  if (reqMs < minMs) errors.push('Must book at least ' + (CONFIG.min_advance_hours || 2) + ' hours in advance');
  if (reqMs > maxMs) errors.push('Cannot book more than ' + (CONFIG.max_advance_days || 90) + ' days out');

  // Business hours check (UTC-based)
  const days = ['sun','mon','tue','wed','thu','fri','sat'];
  const bh = CONFIG.business_hours || {};
  const reqDate = new Date(appt.requested_time);
  const dayKey = days[reqDate.getUTCDay()];
  const dayHours = bh[dayKey];
  if (dayHours === null || dayHours === undefined) {
    errors.push('Requested day is closed');
  } else if (dayHours) {
    const reqHr = reqDate.getUTCHours() + reqDate.getUTCMinutes() / 60;
    const [oh, om] = dayHours.open.split(':').map(Number);
    const [ch, cm] = dayHours.close.split(':').map(Number);
    if (reqHr < oh + om/60 || reqHr >= ch + cm/60) {
      errors.push('Requested time (' + dayHours.open + '–' + dayHours.close + ' UTC) is outside business hours');
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
}
return [{ json: { appt, raw_payload: data.raw_payload } }];
`.trim();

// ─── AVAILABILITY SQL ───────────────────────────────────────────────────────
const AVAILABILITY_SQL = `SELECT
  COUNT(*) AS conflict_count,
  COALESCE(STRING_AGG(
    appointment_id || ':' || COALESCE(contact_name,'Unknown') || ':' || COALESCE(confirmed_time::text,''),
    ' | '
  ), '') AS conflict_details
FROM appointment_log
WHERE status IN ('confirmed','pending_review','pending')
AND client_id = '{{ $json.appt.client_id }}'
AND confirmed_time IS NOT NULL
AND end_time IS NOT NULL
AND (confirmed_time, end_time) OVERLAPS (
  '{{ $json.appt.requested_time }}'::timestamptz,
  '{{ $json.appt.end_time }}'::timestamptz
){{ $json.appt.assigned_staff ? " AND assigned_staff = '" + $json.appt.assigned_staff + "'" : "" }}`;

// ─── PROCESS AVAILABILITY ───────────────────────────────────────────────────
const PROCESS_AVAILABILITY_CODE = `
const pgRow = ${$}input.first().json;
const apptData = ${$}('Validate Booking').first().json;
const appt = { ...apptData.appt };
appt.flags = Array.isArray(appt.flags) ? [...appt.flags] : [];

const conflicts = parseInt(pgRow.conflict_count || pgRow[0]?.conflict_count || 0);
appt.availability_checked = true;

if (conflicts > 0) {
  appt.conflict_detected = true;
  appt.conflict_details = pgRow.conflict_details || pgRow[0]?.conflict_details || '';
  appt.status = 'conflict';
  appt.flags.push('slot_unavailable');

  // Suggest alternatives at +30min, +1h, +2h, next business day
  const base = new Date(appt.requested_time).getTime();
  appt.alternatives = [
    { offset: '+30 min',   time: new Date(base + 30*60000).toISOString() },
    { offset: '+1 hour',   time: new Date(base + 60*60000).toISOString() },
    { offset: '+2 hours',  time: new Date(base + 120*60000).toISOString() },
    { offset: 'Next day',  time: new Date(base + 86400000).toISOString() }
  ];
} else {
  appt.conflict_detected = false;
  appt.flags.push('slot_available');
}
return [{ json: { appt, raw_payload: apptData.raw_payload } }];
`.trim();

// ─── BUILD BOOKING DECISION ─────────────────────────────────────────────────
const BUILD_DECISION_CODE = `
const data = ${$}input.first().json;
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

appt.auto_confirmed = autoConfirm;
appt.scheduling_decision = { auto_confirm: autoConfirm, reason, decided_at: new Date().toISOString() };
return [{ json: { appt, raw_payload: data.raw_payload } }];
`.trim();

// ─── CONFIRM APPOINTMENT ────────────────────────────────────────────────────
const CONFIRM_CODE = `
const data = ${$}input.first().json;
const appt = { ...data.appt };
appt.flags = Array.isArray(appt.flags) ? [...appt.flags] : [];

appt.confirmed_time = appt.requested_time;
appt.status = 'confirmed';
appt.auto_confirmed = true;
appt.processed_at = new Date().toISOString();

// Build reminder sequence based on how far away the appointment is
const confMs = new Date(appt.confirmed_time).getTime();
const nowMs = Date.now();
const hoursAway = (confMs - nowMs) / 3600000;
const seq = [{ type: 'confirmation', send_at: new Date().toISOString(), sent: true }];
if (hoursAway > 24) seq.push({ type: '24h_reminder', send_at: new Date(confMs - 86400000).toISOString(), sent: false });
if (hoursAway > 2)  seq.push({ type: '2h_reminder',  send_at: new Date(confMs - 7200000).toISOString(),  sent: false });
if (hoursAway > 0)  seq.push({ type: 'follow_up',    send_at: new Date(confMs + 7200000).toISOString(),  sent: false });
appt.reminder_sequence = seq;

return [{ json: { appt, raw_payload: data.raw_payload } }];
`.trim();

// ─── QUEUE FOR REVIEW ───────────────────────────────────────────────────────
const QUEUE_REVIEW_CODE = `
const data = ${$}input.first().json;
const appt = { ...data.appt };
appt.status = 'pending_review';
appt.confirmed_time = appt.requested_time;
appt.auto_confirmed = false;
appt.processed_at = new Date().toISOString();
return [{ json: { appt, raw_payload: data.raw_payload } }];
`.trim();

// ─── HANDLE CONFLICT ────────────────────────────────────────────────────────
const HANDLE_CONFLICT_CODE = `
const data = ${$}input.first().json;
const appt = { ...data.appt };
appt.status = 'conflict';
appt.processed_at = new Date().toISOString();
return [{ json: { appt, raw_payload: data.raw_payload } }];
`.trim();

// ─── BUILD RESCHEDULE ───────────────────────────────────────────────────────
const BUILD_RESCHEDULE_CODE = `
const data = ${$}input.first().json;
const appt = { ...data.appt };
appt.flags = Array.isArray(appt.flags) ? [...appt.flags] : [];
const errors = [];

const lookupId = appt.previous_appointment_id || appt.appointment_id;
if (!lookupId) errors.push('appointment_id or previous_appointment_id required for rescheduling');
if (!appt.requested_time) errors.push('New requested_time is required');
if (!appt.contact_email) errors.push('contact_email required to verify identity');

appt.lookup_id = lookupId;

if (errors.length > 0) {
  appt.validation_passed = false;
  appt.validation_errors = errors;
  appt.status = 'rejected';
} else {
  appt.validation_passed = true;
}
return [{ json: { appt, raw_payload: data.raw_payload } }];
`.trim();

// ─── CHECK NEW SLOT SQL ─────────────────────────────────────────────────────
const CHECK_NEW_SLOT_SQL = `SELECT COUNT(*) AS conflict_count
FROM appointment_log
WHERE status IN ('confirmed','pending_review','pending')
AND client_id = '{{ $json.appt.client_id }}'
AND appointment_id != '{{ $json.appt.lookup_id }}'
AND confirmed_time IS NOT NULL AND end_time IS NOT NULL
AND (confirmed_time, end_time) OVERLAPS (
  '{{ $json.appt.requested_time }}'::timestamptz,
  '{{ $json.appt.end_time }}'::timestamptz
){{ $json.appt.assigned_staff ? " AND assigned_staff = '" + $json.appt.assigned_staff + "'" : "" }}`;

// ─── PROCESS RESCHEDULE ─────────────────────────────────────────────────────
const PROCESS_RESCHEDULE_CODE = `
const pgRow = ${$}input.first().json;
const apptData = ${$}('Build Reschedule').first().json;
const appt = { ...apptData.appt };
appt.flags = Array.isArray(appt.flags) ? [...appt.flags] : [];

const conflicts = parseInt(pgRow.conflict_count || pgRow[0]?.conflict_count || 0);
if (conflicts > 0) {
  appt.status = 'conflict';
  appt.conflict_detected = true;
  appt.flags.push('reschedule_slot_unavailable');
  appt.processed_at = new Date().toISOString();
} else {
  appt.confirmed_time = appt.requested_time;
  appt.status = 'rescheduled';
  appt.processed_at = new Date().toISOString();
  appt.flags.push('reschedule_ok');
}
return [{ json: { appt, raw_payload: apptData.raw_payload } }];
`.trim();

// ─── APPLY RESCHEDULE SQL ───────────────────────────────────────────────────
const APPLY_RESCHEDULE_SQL = `UPDATE appointment_log
SET confirmed_time = {{ $json.appt.status === 'rescheduled' ? "'" + $json.appt.confirmed_time + "'::timestamptz" : 'confirmed_time' }},
    end_time       = {{ $json.appt.status === 'rescheduled' ? "'" + $json.appt.end_time + "'::timestamptz" : 'end_time' }},
    status         = '{{ $json.appt.status }}',
    notes          = COALESCE(notes,'') || '{{ $json.appt.status === "rescheduled" ? " | Rescheduled " + $json.appt.processed_at : " | Reschedule conflict " + $json.appt.processed_at }}',
    processed_at   = NOW()
WHERE appointment_id = '{{ $json.appt.lookup_id }}'
AND   client_id      = '{{ $json.appt.client_id }}'
RETURNING appointment_id, status, contact_email, contact_name, confirmed_time`;

// ─── BUILD CANCELLATION ─────────────────────────────────────────────────────
const BUILD_CANCEL_CODE = `
const data = ${$}input.first().json;
const appt = { ...data.appt };
appt.flags = Array.isArray(appt.flags) ? [...appt.flags] : [];
const errors = [];

if (!appt.appointment_id) errors.push('appointment_id is required');
if (!appt.contact_email)  errors.push('contact_email required to verify identity');

if (errors.length > 0) {
  appt.validation_passed = false;
  appt.validation_errors = errors;
  appt.status = 'rejected';
} else {
  appt.validation_passed = true;
  appt.status = 'cancelled';
  appt.processed_at = new Date().toISOString();
}
return [{ json: { appt, raw_payload: data.raw_payload } }];
`.trim();

// ─── APPLY CANCELLATION SQL ─────────────────────────────────────────────────
const APPLY_CANCEL_SQL = `UPDATE appointment_log
SET status       = 'cancelled',
    cancel_reason = {{ $json.appt.cancel_reason ? "'" + $json.appt.cancel_reason.replace(/'/g,"''") + "'" : 'NULL' }},
    processed_at = NOW()
WHERE appointment_id = '{{ $json.appt.appointment_id }}'
AND   client_id      = '{{ $json.appt.client_id }}'
RETURNING appointment_id, status, contact_email, contact_name`;

// ─── PREPARE LOG DATA (convergence — tries all path source nodes) ───────────
const PREP_LOG_CODE = [
  `// Try each source node in priority order — whichever path ran has valid appt.appointment_id`,
  `const sources = ['Confirm Appointment','Queue for Review','Handle Conflict',`,
  `  'Process Reschedule','Build Cancellation','Parse Ollama Intent','Classify Intent'];`,
  `let appt = {}, raw = {};`,
  `for (const src of sources) {`,
  `  try {`,
  `    const d = ${$}(src).first().json;`,
  `    if (d && d.appt && d.appt.appointment_id) { appt = d.appt; raw = d.raw_payload || {}; break; }`,
  `  } catch(e) {}`,
  `}`,
  ``,
  `return [{`,
  `  json: {`,
  `    appointment_id:          appt.appointment_id || 'unknown',`,
  `    execution_id:            appt.execution_id || null,`,
  `    workflow_version:        appt.workflow_version || 'appointment_scheduling_v1',`,
  `    client_id:               appt.client_id || 'default',`,
  `    request_type:            appt.intent || appt.request_type || null,`,
  `    source_type:             appt.source_type || null,`,
  `    source_channel:          appt.source_channel || null,`,
  `    contact_name:            appt.contact_name || null,`,
  `    contact_email:           appt.contact_email || null,`,
  `    contact_phone:           appt.contact_phone || null,`,
  `    service_type:            appt.service_type || null,`,
  `    appointment_type:        appt.appointment_type || null,`,
  `    requested_time:          appt.requested_time || null,`,
  `    confirmed_time:          appt.confirmed_time || appt.requested_time || null,`,
  `    end_time:                appt.end_time || null,`,
  `    timezone:                appt.timezone || 'UTC',`,
  `    duration_minutes:        appt.duration_minutes || 60,`,
  `    buffer_before_minutes:   appt.buffer_before_minutes || 0,`,
  `    buffer_after_minutes:    appt.buffer_after_minutes || 15,`,
  `    assigned_staff:          appt.assigned_staff || null,`,
  `    calendar_target:         appt.calendar_target || null,`,
  `    location_or_link:        appt.location_or_link || null,`,
  `    status:                  appt.status || 'unknown',`,
  `    urgency_level:           appt.urgency_level || 'normal',`,
  `    raw_payload:             JSON.stringify(raw),`,
  `    normalized_payload:      JSON.stringify(appt),`,
  `    scheduling_decision:     JSON.stringify(appt.scheduling_decision || {}),`,
  `    availability_checked:    appt.availability_checked || false,`,
  `    conflict_detected:       appt.conflict_detected || false,`,
  `    auto_confirmed:          appt.auto_confirmed || false,`,
  `    reminder_sequence:       JSON.stringify(appt.reminder_sequence || []),`,
  `    intent_detected:         appt.intent || null,`,
  `    ai_model_used:           appt.ai_model_used || null,`,
  `    ai_model_source:         appt.ai_model_source || 'none',`,
  `    ai_response_time_ms:     appt.ai_response_time_ms || 0,`,
  `    ai_fallback_used:        appt.ai_fallback_used || false,`,
  `    previous_appointment_id: appt.previous_appointment_id || null,`,
  `    cancel_reason:           appt.cancel_reason || null,`,
  `    validation_passed:       appt.validation_passed !== false,`,
  `    validation_errors:       JSON.stringify(appt.validation_errors || []),`,
  `    notes:                   appt.notes ? appt.notes.substring(0, 2000) : null,`,
  `    error_message:           appt.error_message || null,`,
  `    alternatives:            JSON.stringify(appt.alternatives || []),`,
  `    received_at:             appt.received_at || new Date().toISOString(),`,
  `    processed_at:            appt.processed_at || new Date().toISOString()`,
  `  }`,
  `}];`
].join('\n');

// ─── LOG SQL ────────────────────────────────────────────────────────────────
const LOG_SQL = `INSERT INTO appointment_log (
  appointment_id, execution_id, workflow_version, client_id,
  request_type, source_type, source_channel,
  contact_name, contact_email, contact_phone,
  service_type, appointment_type,
  requested_time, confirmed_time, end_time, timezone,
  duration_minutes, buffer_before_minutes, buffer_after_minutes,
  assigned_staff, calendar_target, location_or_link,
  status, urgency_level,
  raw_payload, normalized_payload, scheduling_decision,
  availability_checked, conflict_detected, auto_confirmed,
  reminder_sequence,
  intent_detected, ai_model_used, ai_model_source, ai_response_time_ms, ai_fallback_used,
  previous_appointment_id, cancel_reason,
  validation_passed, validation_errors, notes, error_message,
  received_at, processed_at
) VALUES (
  '{{ $json.appointment_id }}',
  {{ $json.execution_id ? "'" + $json.execution_id + "'" : 'NULL' }},
  '{{ $json.workflow_version }}',
  '{{ $json.client_id }}',
  {{ $json.request_type ? "'" + $json.request_type + "'" : 'NULL' }},
  {{ $json.source_type ? "'" + $json.source_type + "'" : 'NULL' }},
  {{ $json.source_channel ? "'" + $json.source_channel + "'" : 'NULL' }},
  {{ $json.contact_name ? "'" + $json.contact_name.replace(/'/g,"''") + "'" : 'NULL' }},
  {{ $json.contact_email ? "'" + $json.contact_email + "'" : 'NULL' }},
  {{ $json.contact_phone ? "'" + $json.contact_phone + "'" : 'NULL' }},
  {{ $json.service_type ? "'" + $json.service_type + "'" : 'NULL' }},
  {{ $json.appointment_type ? "'" + $json.appointment_type + "'" : 'NULL' }},
  {{ $json.requested_time ? "'" + $json.requested_time + "'" : 'NULL' }}::timestamptz,
  {{ $json.confirmed_time ? "'" + $json.confirmed_time + "'" : 'NULL' }}::timestamptz,
  {{ $json.end_time ? "'" + $json.end_time + "'" : 'NULL' }}::timestamptz,
  '{{ $json.timezone || "UTC" }}',
  {{ $json.duration_minutes || 60 }},
  {{ $json.buffer_before_minutes || 0 }},
  {{ $json.buffer_after_minutes || 15 }},
  {{ $json.assigned_staff ? "'" + $json.assigned_staff + "'" : 'NULL' }},
  {{ $json.calendar_target ? "'" + $json.calendar_target + "'" : 'NULL' }},
  {{ $json.location_or_link ? "'" + $json.location_or_link.replace(/'/g,"''") + "'" : 'NULL' }},
  '{{ $json.status || "unknown" }}',
  '{{ $json.urgency_level || "normal" }}',
  '{{ $json.raw_payload.replace(/'/g,"''") }}'::jsonb,
  '{{ $json.normalized_payload.replace(/'/g,"''") }}'::jsonb,
  '{{ $json.scheduling_decision.replace(/'/g,"''") }}'::jsonb,
  {{ $json.availability_checked }},
  {{ $json.conflict_detected }},
  {{ $json.auto_confirmed }},
  '{{ $json.reminder_sequence }}'::jsonb,
  {{ $json.intent_detected ? "'" + $json.intent_detected + "'" : 'NULL' }},
  {{ $json.ai_model_used ? "'" + $json.ai_model_used + "'" : 'NULL' }},
  '{{ $json.ai_model_source || "none" }}',
  {{ $json.ai_response_time_ms || 0 }},
  {{ $json.ai_fallback_used }},
  {{ $json.previous_appointment_id ? "'" + $json.previous_appointment_id + "'" : 'NULL' }},
  {{ $json.cancel_reason ? "'" + $json.cancel_reason.replace(/'/g,"''") + "'" : 'NULL' }},
  {{ $json.validation_passed }},
  '{{ $json.validation_errors }}'::jsonb,
  {{ $json.notes ? "'" + $json.notes.replace(/'/g,"''") + "'" : 'NULL' }},
  {{ $json.error_message ? "'" + $json.error_message.replace(/'/g,"''") + "'" : 'NULL' }},
  '{{ $json.received_at }}'::timestamptz,
  '{{ $json.processed_at }}'::timestamptz
)
ON CONFLICT (appointment_id) DO UPDATE SET
  status             = EXCLUDED.status,
  confirmed_time     = EXCLUDED.confirmed_time,
  end_time           = EXCLUDED.end_time,
  scheduling_decision= EXCLUDED.scheduling_decision,
  availability_checked=EXCLUDED.availability_checked,
  conflict_detected  = EXCLUDED.conflict_detected,
  auto_confirmed     = EXCLUDED.auto_confirmed,
  reminder_sequence  = EXCLUDED.reminder_sequence,
  ai_model_used      = EXCLUDED.ai_model_used,
  ai_fallback_used   = EXCLUDED.ai_fallback_used,
  processed_at       = EXCLUDED.processed_at
RETURNING appointment_id, status, confirmed_time`;

// ─── WORKFLOW DEFINITION ────────────────────────────────────────────────────
const workflow = {
  name: 'Appointment & Scheduling Automation v1',
  nodes: [
    // ── Entry ──────────────────────────────────────────────────────────────
    {
      id: 'n_webhook', name: 'Appointment Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 300],
      parameters: { httpMethod: 'POST', path: 'appointment', responseMode: 'responseNode', options: {} }
    },
    {
      id: 'n_normalize', name: 'Normalize Appointment', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 300],
      parameters: { jsCode: NORMALIZE_CODE }
    },
    // ── Intent Classification ───────────────────────────────────────────────
    {
      id: 'n_classify', name: 'Classify Intent', type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 300],
      parameters: { jsCode: CLASSIFY_INTENT_CODE }
    },
    {
      id: 'n_ollama_intent', name: 'Ollama Intent', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [660, 300],
      parameters: {
        method: 'POST', url: 'http://host.docker.internal:11434/api/generate',
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
        sendBody: true, contentType: 'raw', rawContentType: 'application/json',
        body: OLLAMA_INTENT_BODY,
        options: { timeout: 30000 }
      },
      continueOnFail: true
    },
    {
      id: 'n_parse_intent', name: 'Parse Ollama Intent', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 300],
      parameters: { jsCode: PARSE_OLLAMA_INTENT_CODE }
    },
    // ── Intent Router ───────────────────────────────────────────────────────
    {
      id: 'n_router', name: 'Intent Router', type: 'n8n-nodes-base.switch', typeVersion: 3, position: [1100, 300],
      parameters: {
        mode: 'rules',
        rules: {
          values: [
            {
              conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: `={{ ${$}json.appt.intent }}`, rightValue: 'book', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
              renameOutput: true, outputKey: 'book'
            },
            {
              conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: `={{ ${$}json.appt.intent }}`, rightValue: 'reschedule', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
              renameOutput: true, outputKey: 'reschedule'
            },
            {
              conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: `={{ ${$}json.appt.intent }}`, rightValue: 'cancel', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
              renameOutput: true, outputKey: 'cancel'
            }
          ]
        },
        fallbackOutput: 'extra'  // inquiry / unknown → goes to Prepare Log Data
      }
    },
    // ── BOOK PATH ───────────────────────────────────────────────────────────
    {
      id: 'n_validate', name: 'Validate Booking', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1340, 120],
      parameters: { jsCode: VALIDATE_BOOKING_CODE }
    },
    {
      id: 'n_val_gate', name: 'Validation Gate', type: 'n8n-nodes-base.if', typeVersion: 2, position: [1560, 120],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
          conditions: [{ leftValue: `={{ ${$}json.appt.validation_passed }}`, rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and'
        }
      }
    },
    {
      id: 'n_check_avail', name: 'Check Availability', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [1780, 60],
      parameters: { operation: 'executeQuery', query: AVAILABILITY_SQL, options: {} },
      credentials: { postgres: { id: 'MMScP2tKEgzvhkYM', name: 'Postgres account' } },
      continueOnFail: true
    },
    {
      id: 'n_proc_avail', name: 'Process Availability', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2000, 60],
      parameters: { jsCode: PROCESS_AVAILABILITY_CODE }
    },
    {
      id: 'n_avail_gate', name: 'Availability Gate', type: 'n8n-nodes-base.if', typeVersion: 2, position: [2220, 60],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
          conditions: [{ leftValue: `={{ ${$}json.appt.conflict_detected }}`, rightValue: false, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and'
        }
      }
    },
    {
      id: 'n_decision', name: 'Build Booking Decision', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2440, -40],
      parameters: { jsCode: BUILD_DECISION_CODE }
    },
    {
      id: 'n_auto_gate', name: 'Auto-Confirm Gate', type: 'n8n-nodes-base.if', typeVersion: 2, position: [2660, -40],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
          conditions: [{ leftValue: `={{ ${$}json.appt.auto_confirmed }}`, rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and'
        }
      }
    },
    {
      id: 'n_confirm', name: 'Confirm Appointment', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2880, -120],
      parameters: { jsCode: CONFIRM_CODE }
    },
    {
      id: 'n_email_confirm', name: 'Send Confirmation', type: 'n8n-nodes-base.gmail', typeVersion: 2, position: [3100, -120],
      parameters: {
        sendTo: `={{ ${$}json.appt.contact_email }}`,
        subject: `={{ 'Appointment Confirmed — ' + (${$}json.appt.service_type || 'Appointment') + ' on ' + new Date(${$}json.appt.confirmed_time).toLocaleDateString('en-US', {weekday:'short',month:'short',day:'numeric',year:'numeric'}) }}`,
        emailType: 'html',
        message: `={{ '<h2 style="color:#2d6a4f">Your Appointment is Confirmed</h2><table style="border-collapse:collapse;width:100%;max-width:560px"><tr><td style="padding:8px 12px;border:1px solid #ddd;background:#f9f9f9"><b>Service</b></td><td style="padding:8px 12px;border:1px solid #ddd">' + (${$}json.appt.service_type || 'Appointment') + '</td></tr><tr><td style="padding:8px 12px;border:1px solid #ddd;background:#f9f9f9"><b>Date & Time</b></td><td style="padding:8px 12px;border:1px solid #ddd">' + new Date(${$}json.appt.confirmed_time).toLocaleString('en-US', {timeZone:${$}json.appt.timezone||'UTC'}) + ' (' + (${$}json.appt.timezone||'UTC') + ')</td></tr><tr><td style="padding:8px 12px;border:1px solid #ddd;background:#f9f9f9"><b>Duration</b></td><td style="padding:8px 12px;border:1px solid #ddd">' + ${$}json.appt.duration_minutes + ' minutes</td></tr>' + (${$}json.appt.location_or_link ? '<tr><td style="padding:8px 12px;border:1px solid #ddd;background:#f9f9f9"><b>Location / Link</b></td><td style="padding:8px 12px;border:1px solid #ddd">' + ${$}json.appt.location_or_link + '</td></tr>' : '') + (${$}json.appt.assigned_staff ? '<tr><td style="padding:8px 12px;border:1px solid #ddd;background:#f9f9f9"><b>With</b></td><td style="padding:8px 12px;border:1px solid #ddd">' + ${$}json.appt.assigned_staff + '</td></tr>' : '') + '<tr><td style="padding:8px 12px;border:1px solid #ddd;background:#f9f9f9"><b>Reference ID</b></td><td style="padding:8px 12px;border:1px solid #ddd;font-family:monospace">' + ${$}json.appt.appointment_id + '</td></tr></table>' + (${$}json.appt.notes ? '<p><b>Your notes:</b> ' + ${$}json.appt.notes + '</p>' : '') + '<p style="color:#555;font-size:13px">To reschedule or cancel, contact us and reference your ID above.</p>' }}`,
        options: {}
      },
      credentials: { gmailOAuth2: { id: 'bHMHyGqUtDInnHet', name: 'Gmail account' } },
      continueOnFail: true
    },
    {
      id: 'n_queue', name: 'Queue for Review', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2880, 0],
      parameters: { jsCode: QUEUE_REVIEW_CODE }
    },
    {
      id: 'n_notify_staff', name: 'Notify Staff', type: 'n8n-nodes-base.gmail', typeVersion: 2, position: [3100, 0],
      parameters: {
        sendTo: 'qadautomation@gmail.com',
        subject: `={{ '[Review Required] ' + (${$}json.appt.urgency_level === 'urgent' ? '🚨 URGENT — ' : '') + (${$}json.appt.service_type || 'Appointment') + ' request from ' + (${$}json.appt.contact_name || ${$}json.appt.contact_email) }}`,
        emailType: 'html',
        message: `={{ '<h2>Appointment Request — Staff Review Required</h2><table style="border-collapse:collapse;width:100%;max-width:560px"><tr><td style="padding:8px;border:1px solid #ddd"><b>Client</b></td><td style="padding:8px;border:1px solid #ddd">' + (${$}json.appt.contact_name || 'N/A') + ' (' + (${$}json.appt.contact_email || 'N/A') + ')</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><b>Service</b></td><td style="padding:8px;border:1px solid #ddd">' + (${$}json.appt.service_type || 'N/A') + '</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><b>Requested Time</b></td><td style="padding:8px;border:1px solid #ddd">' + (${$}json.appt.requested_time ? new Date(${$}json.appt.requested_time).toLocaleString() : 'N/A') + '</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><b>Urgency</b></td><td style="padding:8px;border:1px solid #ddd">' + ${$}json.appt.urgency_level + '</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><b>ID</b></td><td style="padding:8px;border:1px solid #ddd;font-family:monospace">' + ${$}json.appt.appointment_id + '</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><b>Reason Queued</b></td><td style="padding:8px;border:1px solid #ddd">' + ((${$}json.appt.scheduling_decision || {}).reason || 'N/A') + '</td></tr></table><p>Please confirm or decline this appointment.</p>' }}`,
        options: {}
      },
      credentials: { gmailOAuth2: { id: 'bHMHyGqUtDInnHet', name: 'Gmail account' } },
      continueOnFail: true
    },
    {
      id: 'n_conflict', name: 'Handle Conflict', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2440, 140],
      parameters: { jsCode: HANDLE_CONFLICT_CODE }
    },
    {
      id: 'n_email_conflict', name: 'Send Conflict Notice', type: 'n8n-nodes-base.gmail', typeVersion: 2, position: [2660, 140],
      parameters: {
        sendTo: `={{ ${$}json.appt.contact_email }}`,
        subject: `={{ 'Time Slot Unavailable — ' + (${$}json.appt.service_type || 'Appointment') + ' Request' }}`,
        emailType: 'html',
        message: `={{ '<h2>That time slot is not available</h2><p>We could not book your ' + (${$}json.appt.service_type || 'appointment') + ' for ' + new Date(${$}json.appt.requested_time).toLocaleString() + '.</p><h3>Available alternatives:</h3><ul>' + (${$}json.appt.alternatives || []).map(a => '<li>' + a.offset + ': ' + new Date(a.time).toLocaleString() + '</li>').join('') + '</ul><p>Reply to this email or rebook using your reference: <code>' + ${$}json.appt.appointment_id + '</code></p>' }}`,
        options: {}
      },
      credentials: { gmailOAuth2: { id: 'bHMHyGqUtDInnHet', name: 'Gmail account' } },
      continueOnFail: true
    },
    {
      id: 'n_val_fail', name: 'Validation Fail Response', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [1780, 260],
      parameters: {
        respondWith: 'json',
        responseBody: `={{ { status: "error", error_type: "validation", errors: ${$}json.appt.validation_errors, appointment_id: ${$}json.appt.appointment_id } }}`,
        options: { responseCode: 400 }
      }
    },
    {
      id: 'n_val_fail_log', name: 'Log Validation Failure', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [1780, 380],
      parameters: {
        operation: 'executeQuery',
        query: `INSERT INTO appointment_log (appointment_id, execution_id, workflow_version, client_id, source_type, contact_email, service_type, requested_time, status, validation_passed, validation_errors, raw_payload, normalized_payload, received_at, processed_at) VALUES ('{{ $json.appt.appointment_id }}', {{ $json.appt.execution_id ? "'" + $json.appt.execution_id + "'" : 'NULL' }}, 'appointment_scheduling_v1', '{{ $json.appt.client_id }}', {{ $json.appt.source_type ? "'" + $json.appt.source_type + "'" : 'NULL' }}, {{ $json.appt.contact_email ? "'" + $json.appt.contact_email + "'" : 'NULL' }}, {{ $json.appt.service_type ? "'" + $json.appt.service_type + "'" : 'NULL' }}, {{ $json.appt.requested_time ? "'" + $json.appt.requested_time + "'" : 'NULL' }}::timestamptz, 'rejected', false, '{{ JSON.stringify($json.appt.validation_errors) }}'::jsonb, '{{ JSON.stringify($json.raw_payload).replace(/'/g,"''") }}'::jsonb, '{{ JSON.stringify($json.appt).replace(/'/g,"''") }}'::jsonb, NOW(), NOW()) ON CONFLICT (appointment_id) DO NOTHING;`,
        options: {}
      },
      credentials: { postgres: { id: 'MMScP2tKEgzvhkYM', name: 'Postgres account' } },
      continueOnFail: true
    },
    // ── RESCHEDULE PATH ─────────────────────────────────────────────────────
    {
      id: 'n_build_reschedule', name: 'Build Reschedule', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1340, 380],
      parameters: { jsCode: BUILD_RESCHEDULE_CODE }
    },
    {
      id: 'n_check_new_slot', name: 'Check New Slot', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [1560, 380],
      parameters: { operation: 'executeQuery', query: CHECK_NEW_SLOT_SQL, options: {} },
      credentials: { postgres: { id: 'MMScP2tKEgzvhkYM', name: 'Postgres account' } },
      continueOnFail: true
    },
    {
      id: 'n_proc_reschedule', name: 'Process Reschedule', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1780, 380],
      parameters: { jsCode: PROCESS_RESCHEDULE_CODE }
    },
    {
      id: 'n_apply_reschedule', name: 'Apply Reschedule', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [2000, 380],
      parameters: { operation: 'executeQuery', query: APPLY_RESCHEDULE_SQL, options: {} },
      credentials: { postgres: { id: 'MMScP2tKEgzvhkYM', name: 'Postgres account' } },
      continueOnFail: true
    },
    {
      id: 'n_email_reschedule', name: 'Send Reschedule Email', type: 'n8n-nodes-base.gmail', typeVersion: 2, position: [2220, 380],
      parameters: {
        sendTo: `={{ ${$}json.appt.contact_email }}`,
        subject: `={{ ${$}json.appt.status === 'rescheduled' ? 'Appointment Rescheduled — ' + (${$}json.appt.service_type || 'Appointment') : 'Reschedule Request — Time Slot Unavailable' }}`,
        emailType: 'html',
        message: `={{ ${$}json.appt.status === 'rescheduled' ? '<h2 style="color:#2d6a4f">Appointment Rescheduled</h2><p>Your appointment has been moved to <b>' + new Date(${$}json.appt.confirmed_time).toLocaleString('en-US', {timeZone:${$}json.appt.timezone||'UTC'}) + '</b>.</p><p>Reference: <code>' + ${$}json.appt.appointment_id + '</code></p>' : '<h2>New Time Slot Unavailable</h2><p>The new time you requested is not available. Your original appointment remains unchanged.</p><p>Reference: <code>' + (${$}json.appt.previous_appointment_id || ${$}json.appt.appointment_id) + '</code></p>' }}`,
        options: {}
      },
      credentials: { gmailOAuth2: { id: 'bHMHyGqUtDInnHet', name: 'Gmail account' } },
      continueOnFail: true
    },
    // ── CANCEL PATH ─────────────────────────────────────────────────────────
    {
      id: 'n_build_cancel', name: 'Build Cancellation', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1340, 540],
      parameters: { jsCode: BUILD_CANCEL_CODE }
    },
    {
      id: 'n_apply_cancel', name: 'Apply Cancellation', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [1560, 540],
      parameters: { operation: 'executeQuery', query: APPLY_CANCEL_SQL, options: {} },
      credentials: { postgres: { id: 'MMScP2tKEgzvhkYM', name: 'Postgres account' } },
      continueOnFail: true
    },
    {
      id: 'n_email_cancel', name: 'Send Cancellation Email', type: 'n8n-nodes-base.gmail', typeVersion: 2, position: [1780, 540],
      parameters: {
        sendTo: `={{ ${$}json.appt.contact_email }}`,
        subject: `={{ 'Appointment Cancelled — ' + (${$}json.appt.service_type || 'Appointment') }}`,
        emailType: 'html',
        message: `={{ '<h2>Appointment Cancelled</h2><p>Your appointment has been cancelled.</p>' + (${$}json.appt.cancel_reason ? '<p><b>Reason:</b> ' + ${$}json.appt.cancel_reason + '</p>' : '') + '<p>Reference ID: <code>' + ${$}json.appt.appointment_id + '</code></p><p>To rebook, simply reply to this email or submit a new booking request.</p>' }}`,
        options: {}
      },
      credentials: { gmailOAuth2: { id: 'bHMHyGqUtDInnHet', name: 'Gmail account' } },
      continueOnFail: true
    },
    // ── CONVERGENCE ─────────────────────────────────────────────────────────
    {
      id: 'n_prep_log', name: 'Prepare Log Data', type: 'n8n-nodes-base.code', typeVersion: 2, position: [3380, 200],
      parameters: { jsCode: PREP_LOG_CODE }
    },
    {
      id: 'n_log_pg', name: 'Log to PostgreSQL', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [3600, 200],
      parameters: { operation: 'executeQuery', query: LOG_SQL, options: {} },
      credentials: { postgres: { id: 'MMScP2tKEgzvhkYM', name: 'Postgres account' } },
      continueOnFail: true
    },
    {
      id: 'n_respond', name: 'Webhook Response', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [3820, 200],
      parameters: {
        respondWith: 'json',
        responseBody: `={{ (() => { const d = ${$}('Prepare Log Data').first().json; const base = { appointment_id: d.appointment_id, status: d.status, service_type: d.service_type, contact_email: d.contact_email, processed_at: d.processed_at }; if (d.status === 'confirmed') return { ...base, confirmed_time: d.confirmed_time, duration_minutes: d.duration_minutes, location_or_link: d.location_or_link, message: 'Appointment confirmed.' }; if (d.status === 'pending_review') return { ...base, requested_time: d.requested_time, message: 'Request received — awaiting staff confirmation.' }; if (d.status === 'conflict') return { ...base, requested_time: d.requested_time, alternatives: JSON.parse(d.alternatives || '[]'), message: 'Requested slot unavailable — see alternatives.' }; if (d.status === 'rescheduled') return { ...base, confirmed_time: d.confirmed_time, message: 'Appointment rescheduled.' }; if (d.status === 'cancelled') return { ...base, message: 'Appointment cancelled.' }; if (d.status === 'inquiry') return { ...base, message: 'Inquiry received.' }; return { ...base, message: 'Request processed.' }; })() }}`,
        options: { responseCode: 200 }
      }
    },
    // ── ERROR HANDLER ───────────────────────────────────────────────────────
    {
      id: 'n_error', name: 'Error Handler', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 600],
      parameters: {}
    },
    {
      id: 'n_error_log', name: 'Log Workflow Error', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [220, 600],
      parameters: {
        operation: 'executeQuery',
        query: `INSERT INTO workflow_errors (execution_id, workflow_id, error_type, error_message, failed_at, retry_count, resolved) VALUES ('{{ $json.execution.id }}', 'appointment_scheduling_v1', 'fatal', '{{ ($json.error.message || "Unknown").replace(/'/g,"''") }}', NOW(), 0, false);`,
        options: {}
      },
      credentials: { postgres: { id: 'MMScP2tKEgzvhkYM', name: 'Postgres account' } },
      continueOnFail: true
    }
  ],
  connections: {
    'Appointment Webhook': { main: [[{ node: 'Normalize Appointment',   type: 'main', index: 0 }]] },
    'Normalize Appointment': { main: [[{ node: 'Classify Intent',        type: 'main', index: 0 }]] },
    'Classify Intent':       { main: [[{ node: 'Ollama Intent',          type: 'main', index: 0 }]] },
    'Ollama Intent':         { main: [[{ node: 'Parse Ollama Intent',    type: 'main', index: 0 }]] },
    'Parse Ollama Intent':   { main: [[{ node: 'Intent Router',          type: 'main', index: 0 }]] },
    'Intent Router': {
      main: [
        [{ node: 'Validate Booking',   type: 'main', index: 0 }],   // book
        [{ node: 'Build Reschedule',   type: 'main', index: 0 }],   // reschedule
        [{ node: 'Build Cancellation', type: 'main', index: 0 }],   // cancel
        [{ node: 'Prepare Log Data',   type: 'main', index: 0 }]    // inquiry / fallback
      ]
    },
    // Book path
    'Validate Booking': { main: [[{ node: 'Validation Gate', type: 'main', index: 0 }]] },
    'Validation Gate': {
      main: [
        [{ node: 'Check Availability',       type: 'main', index: 0 }],
        [{ node: 'Validation Fail Response', type: 'main', index: 0 }, { node: 'Log Validation Failure', type: 'main', index: 0 }]
      ]
    },
    'Check Availability':  { main: [[{ node: 'Process Availability',   type: 'main', index: 0 }]] },
    'Process Availability':{ main: [[{ node: 'Availability Gate',      type: 'main', index: 0 }]] },
    'Availability Gate': {
      main: [
        [{ node: 'Build Booking Decision', type: 'main', index: 0 }],  // available
        [{ node: 'Handle Conflict',        type: 'main', index: 0 }]   // conflict
      ]
    },
    'Build Booking Decision': { main: [[{ node: 'Auto-Confirm Gate', type: 'main', index: 0 }]] },
    'Auto-Confirm Gate': {
      main: [
        [{ node: 'Confirm Appointment', type: 'main', index: 0 }],   // auto-confirm
        [{ node: 'Queue for Review',    type: 'main', index: 0 }]    // needs review
      ]
    },
    'Confirm Appointment':  { main: [[{ node: 'Send Confirmation',    type: 'main', index: 0 }]] },
    'Send Confirmation':    { main: [[{ node: 'Prepare Log Data',     type: 'main', index: 0 }]] },
    'Queue for Review':     { main: [[{ node: 'Notify Staff',         type: 'main', index: 0 }]] },
    'Notify Staff':         { main: [[{ node: 'Prepare Log Data',     type: 'main', index: 0 }]] },
    'Handle Conflict':      { main: [[{ node: 'Send Conflict Notice', type: 'main', index: 0 }]] },
    'Send Conflict Notice': { main: [[{ node: 'Prepare Log Data',     type: 'main', index: 0 }]] },
    // Reschedule path
    'Build Reschedule':   { main: [[{ node: 'Check New Slot',        type: 'main', index: 0 }]] },
    'Check New Slot':     { main: [[{ node: 'Process Reschedule',    type: 'main', index: 0 }]] },
    'Process Reschedule': { main: [[{ node: 'Apply Reschedule',      type: 'main', index: 0 }]] },
    'Apply Reschedule':   { main: [[{ node: 'Send Reschedule Email', type: 'main', index: 0 }]] },
    'Send Reschedule Email': { main: [[{ node: 'Prepare Log Data',   type: 'main', index: 0 }]] },
    // Cancel path
    'Build Cancellation':  { main: [[{ node: 'Apply Cancellation',   type: 'main', index: 0 }]] },
    'Apply Cancellation':  { main: [[{ node: 'Send Cancellation Email', type: 'main', index: 0 }]] },
    'Send Cancellation Email': { main: [[{ node: 'Prepare Log Data', type: 'main', index: 0 }]] },
    // Convergence
    'Prepare Log Data':   { main: [[{ node: 'Log to PostgreSQL',    type: 'main', index: 0 }]] },
    'Log to PostgreSQL':  { main: [[{ node: 'Webhook Response',     type: 'main', index: 0 }]] },
    // Error
    'Error Handler':      { main: [[{ node: 'Log Workflow Error',   type: 'main', index: 0 }]] }
  },
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  staticData: null
};

async function main() {
  console.log('Creating Appointment & Scheduling workflow...');
  const result = await req('POST', '/api/v1/workflows', workflow);
  if (!result.id) { console.log('Error:', JSON.stringify(result).substring(0, 400)); return; }
  console.log('Created workflow ID:', result.id);

  const active = await req('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('active:', active.active);
  console.log('Webhook: http://localhost:5678/webhook/appointment');
}

main().catch(console.error);
