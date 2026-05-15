// Run the exact queries from overview.js
process.env.PGHOST = "localhost";
process.env.PGPORT = "5433";
process.env.PGUSER = "qad_user";
process.env.PGPASSWORD = "changeme";
process.env.PGDATABASE = "qad";

import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ host: "localhost", port: 5433, database: "qad", user: "qad_user", password: "changeme", max: 2 });

const query = async (sql, params) => {
  const client = await pool.connect();
  try { const r = await client.query(sql, params); return r.rows; } finally { client.release(); }
};

const client_id = "acme_corp";
try {
  const kpis = await query(`
    SELECT COUNT(*)::int AS total_runs,
    ROUND(AVG(CASE WHEN run_status = 'success' THEN 100.0 ELSE 0 END), 1) AS success_rate,
    COUNT(CASE WHEN started_at > NOW() - INTERVAL '24 hours' THEN 1 END)::int AS runs_today
    FROM workflow_runs WHERE client_id = $1 AND started_at > NOW() - INTERVAL '30 days'
  `, [client_id]);
  console.log("kpis:", JSON.stringify(kpis));
} catch(e) { console.log("kpis FAIL:", e.message); }

try {
  const exceptions = await query(`
    SELECT
      (SELECT COUNT(*) FROM intake_log WHERE client_id = $1 AND qualification_tier = 'pending_review') +
      (SELECT COUNT(*) FROM document_log WHERE client_id = $1 AND processing_status IN ('human_review','pending_review')) +
      (SELECT COUNT(*) FROM appointment_log WHERE client_id = $1 AND status IN ('pending_review','pending')) +
      (SELECT COUNT(*) FROM workflow_runs WHERE client_id = $1 AND run_status = 'failure' AND started_at > NOW() - INTERVAL '7 days')
      AS open_exceptions
  `, [client_id]);
  console.log("exceptions:", JSON.stringify(exceptions));
} catch(e) { console.log("exceptions FAIL:", e.message); }

await pool.end();
