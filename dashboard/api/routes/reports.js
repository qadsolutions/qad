import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query } from '../db.js';

const router = Router();
const __dir = dirname(fileURLToPath(import.meta.url));

// table/statusField come from server-controlled config, not user input
const METRIC_BUILDERS = {
  total_leads:             { key: 'total',             sql: (t)     => `SELECT COUNT(*)::int AS total FROM ${t} WHERE client_id = $1 AND received_at > NOW() - ($2 || ' days')::interval` },
  total_documents:         { key: 'total',             sql: (t)     => `SELECT COUNT(*)::int AS total FROM ${t} WHERE client_id = $1 AND received_at > NOW() - ($2 || ' days')::interval` },
  total_appointments:      { key: 'total',             sql: (t)     => `SELECT COUNT(*)::int AS total FROM ${t} WHERE client_id = $1 AND received_at > NOW() - ($2 || ' days')::interval` },
  tier_breakdown:          { key: 'breakdown',         sql: (t, sf) => `SELECT ${sf} AS status, COUNT(*)::int AS count FROM ${t} WHERE client_id = $1 AND received_at > NOW() - ($2 || ' days')::interval GROUP BY ${sf} ORDER BY count DESC` },
  status_breakdown:        { key: 'breakdown',         sql: (t, sf) => `SELECT ${sf} AS status, COUNT(*)::int AS count FROM ${t} WHERE client_id = $1 AND received_at > NOW() - ($2 || ' days')::interval GROUP BY ${sf} ORDER BY count DESC` },
  classification_breakdown:{ key: 'breakdown',         sql: (t)     => `SELECT classification_label AS status, COUNT(*)::int AS count FROM ${t} WHERE client_id = $1 AND received_at > NOW() - ($2 || ' days')::interval GROUP BY classification_label ORDER BY count DESC` },
  avg_score:               { key: 'avg_score',         sql: (t)     => `SELECT ROUND(AVG(qualification_score), 1)::float AS value FROM ${t} WHERE client_id = $1 AND received_at > NOW() - ($2 || ' days')::interval` },
  auto_process_rate:       { key: 'auto_process_rate', sql: (t)     => `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE processing_status IN ('success','auto_process')) / NULLIF(COUNT(*),0), 1)::float AS value FROM ${t} WHERE client_id = $1 AND received_at > NOW() - ($2 || ' days')::interval` },
  auto_confirm_rate:       { key: 'auto_confirm_rate', sql: (t)     => `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE auto_confirmed = true) / NULLIF(COUNT(*),0), 1)::float AS value FROM ${t} WHERE client_id = $1 AND received_at > NOW() - ($2 || ' days')::interval` },
};

router.get('/', async (req, res) => {
  const { client_id = 'acme_corp', range = '30' } = req.query;
  const days = Math.min(Math.max(parseInt(range) || 30, 1), 365);

  if (!/^[a-z0-9_-]+$/i.test(client_id)) {
    return res.status(400).json({ error: 'Invalid client_id' });
  }

  let clientConfig;
  try {
    clientConfig = JSON.parse(readFileSync(join(__dir, `../config/${client_id}.json`), 'utf8'));
  } catch {
    return res.status(404).json({ error: `Config not found for client: ${client_id}` });
  }

  try {
    // Build per-automation metric promises before Promise.all
    const metricPromises = (clientConfig.automations || []).flatMap(auto =>
      (auto.report_metrics || [])
        .filter(m => METRIC_BUILDERS[m])
        .map(m => {
          const builder = METRIC_BUILDERS[m];
          return query(builder.sql(auto.db_table, auto.status_field), [client_id, days])
            .then(rows => ({ automationId: auto.id, key: builder.key, rows }));
        })
    );

    const [summary, daily, ...metricResults] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::int AS total_runs,
          COUNT(CASE WHEN run_status = 'success' THEN 1 END)::int AS total_successes,
          ROUND(AVG(CASE WHEN run_status = 'success' THEN 100.0 ELSE 0 END), 1) AS success_rate,
          COUNT(CASE WHEN run_status = 'failure' THEN 1 END)::int AS total_failures
        FROM workflow_runs
        WHERE client_id = $1 AND started_at > NOW() - ($2 || ' days')::interval
      `, [client_id, days]),

      query(`
        SELECT
          DATE_TRUNC('day', started_at)::date AS day,
          COUNT(*)::int AS total_count,
          COUNT(CASE WHEN run_status = 'success' THEN 1 END)::int AS success_count,
          COUNT(CASE WHEN run_status = 'failure' THEN 1 END)::int AS failed_count,
          COUNT(CASE WHEN run_status NOT IN ('success','failure') THEN 1 END)::int AS review_count
        FROM workflow_runs
        WHERE client_id = $1 AND started_at > NOW() - ($2 || ' days')::interval
        GROUP BY DATE_TRUNC('day', started_at)
        ORDER BY day
      `, [client_id, days]),

      ...metricPromises,
    ]);

    const automations = {};
    for (const { automationId, key, rows } of metricResults) {
      if (!automations[automationId]) automations[automationId] = {};
      if (key === 'total') {
        automations[automationId].total = rows[0]?.total ?? 0;
      } else if (key === 'breakdown') {
        automations[automationId].breakdown = rows;
      } else {
        automations[automationId][key] = rows[0]?.value ?? null;
      }
    }

    res.json({ summary: summary[0], daily, automations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

export default router;
