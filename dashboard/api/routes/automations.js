import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// All automations summary
router.get('/', async (req, res) => {
  const { client_id = 'acme_corp' } = req.query;
  try {
    const rows = await query(`
      SELECT
        workflow_id,
        workflow_name,
        MAX(started_at)   AS last_run,
        COUNT(*)::int     AS total_runs_30d,
        COUNT(CASE WHEN run_status = 'success' THEN 1 END)::int AS successes,
        COUNT(CASE WHEN run_status = 'failure' THEN 1 END)::int AS failures,
        ROUND(AVG(CASE WHEN run_status = 'success' THEN 100.0 ELSE 0 END), 1) AS success_rate,
        ROUND(AVG(EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)::numeric, 0)::int AS avg_duration_ms,
        (ARRAY_AGG(run_status ORDER BY started_at DESC))[1] AS last_status,
        (ARRAY_AGG(business_outcome ORDER BY started_at DESC))[1] AS last_outcome
      FROM workflow_runs
      WHERE client_id = $1 AND started_at > NOW() - INTERVAL '30 days'
      GROUP BY workflow_id, workflow_name
      ORDER BY last_run DESC
    `, [client_id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load automations' });
  }
});

// Single automation detail + run history
router.get('/:workflowId', async (req, res) => {
  const { client_id = 'acme_corp' } = req.query;
  const { workflowId } = req.params;
  try {
    const [summary, runs, daily] = await Promise.all([
      query(`
        SELECT
          workflow_id, workflow_name,
          COUNT(*)::int AS total_runs,
          COUNT(CASE WHEN run_status = 'success' THEN 1 END)::int AS successes,
          COUNT(CASE WHEN run_status = 'failure' THEN 1 END)::int AS failures,
          ROUND(AVG(CASE WHEN run_status = 'success' THEN 100.0 ELSE 0 END), 1) AS success_rate,
          MAX(started_at) AS last_run,
          ROUND(AVG(EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)::numeric, 0)::int AS avg_duration_ms
        FROM workflow_runs
        WHERE client_id = $1 AND workflow_id = $2
        GROUP BY workflow_id, workflow_name
      `, [client_id, workflowId]),

      query(`
        SELECT execution_id, started_at, ended_at,
               EXTRACT(EPOCH FROM (ended_at - started_at))::int AS duration_s,
               run_status, source_type, business_outcome, business_outcome_detail
        FROM workflow_runs
        WHERE client_id = $1 AND workflow_id = $2
        ORDER BY started_at DESC
        LIMIT 50
      `, [client_id, workflowId]),

      query(`
        SELECT
          DATE_TRUNC('day', started_at)::date AS day,
          COUNT(*)::int AS runs,
          ROUND(AVG(CASE WHEN run_status = 'success' THEN 100.0 ELSE 0 END), 1) AS success_rate
        FROM workflow_runs
        WHERE client_id = $1 AND workflow_id = $2
          AND started_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('day', started_at)
        ORDER BY day
      `, [client_id, workflowId]),
    ]);

    if (!summary.length) return res.status(404).json({ error: 'Automation not found' });
    res.json({ summary: summary[0], runs, daily });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load automation detail' });
  }
});

export default router;
