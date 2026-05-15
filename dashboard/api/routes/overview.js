import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { client_id = 'acme_corp' } = req.query;
  try {
    const [kpis, health, activity, upcoming] = await Promise.all([
      // KPI strip
      query(`
        SELECT
          COUNT(*)::int                                                    AS total_runs,
          ROUND(AVG(CASE WHEN run_status = 'success' THEN 100.0 ELSE 0 END), 1) AS success_rate,
          COUNT(CASE WHEN started_at > NOW() - INTERVAL '24 hours' THEN 1 END)::int AS runs_today
        FROM workflow_runs
        WHERE client_id = $1 AND started_at > NOW() - INTERVAL '30 days'
      `, [client_id]),

      // Automation health cards (one row per workflow)
      query(`
        SELECT
          workflow_id,
          workflow_name,
          MAX(started_at)                                                   AS last_run,
          COUNT(*)::int                                                     AS total_runs,
          ROUND(AVG(CASE WHEN run_status = 'success' THEN 100.0 ELSE 0 END), 1) AS success_rate,
          (ARRAY_AGG(run_status ORDER BY started_at DESC))[1]               AS last_status,
          (ARRAY_AGG(business_outcome ORDER BY started_at DESC))[1]         AS last_outcome
        FROM workflow_runs
        WHERE client_id = $1 AND started_at > NOW() - INTERVAL '7 days'
        GROUP BY workflow_id, workflow_name
        ORDER BY last_run DESC
      `, [client_id]),

      // Recent activity (last 10)
      query(`
        SELECT automation, record_id, client_id, source_type, status,
               contact_email, service_type, activity_time, processed_at
        FROM v_recent_activity
        WHERE client_id = $1
        ORDER BY activity_time DESC
        LIMIT 10
      `, [client_id]),

      // Upcoming appointments (next 5)
      query(`
        SELECT appointment_id, contact_name, contact_email,
               service_type, confirmed_time AS appointment_time, status, timezone
        FROM appointment_log
        WHERE client_id = $1
          AND confirmed_time > NOW()
          AND status IN ('confirmed', 'pending_review', 'pending')
        ORDER BY confirmed_time ASC
        LIMIT 5
      `, [client_id]),
    ]);

    // Open exceptions count
    const [exceptions] = await query(`
      SELECT
        (SELECT COUNT(*) FROM intake_log     WHERE client_id = $1 AND qualification_tier = 'pending_review')  +
        (SELECT COUNT(*) FROM document_log   WHERE client_id = $1 AND processing_status IN ('human_review','pending_review')) +
        (SELECT COUNT(*) FROM appointment_log WHERE client_id = $1 AND status IN ('pending_review','pending')) +
        (SELECT COUNT(*) FROM workflow_runs  WHERE client_id = $1 AND run_status = 'failure'
           AND started_at > NOW() - INTERVAL '7 days')
        AS open_exceptions
    `, [client_id]);

    // 7-day sparkline data per workflow
    const sparklines = await query(`
      SELECT
        workflow_id,
        DATE_TRUNC('day', started_at)::date AS day,
        COUNT(*)::int                        AS runs,
        ROUND(AVG(CASE WHEN run_status = 'success' THEN 100.0 ELSE 0 END), 1) AS success_rate
      FROM workflow_runs
      WHERE client_id = $1 AND started_at > NOW() - INTERVAL '7 days'
      GROUP BY workflow_id, DATE_TRUNC('day', started_at)
      ORDER BY workflow_id, day
    `, [client_id]);

    res.json({
      kpis: {
        ...kpis[0],
        open_exceptions: parseInt(exceptions?.open_exceptions || 0),
      },
      health,
      sparklines,
      activity,
      upcoming_appointments: upcoming,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load overview data' });
  }
});

export default router;
