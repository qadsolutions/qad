import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { client_id = 'acme_corp' } = req.query;
  try {
    const [intakeExceptions, docExceptions, apptExceptions, failedRuns] = await Promise.all([
      query(`
        SELECT 'intake' AS automation, intake_id AS record_id,
               contact_name, contact_email, qualification_tier AS status,
               qualification_score,
               'pending_review' AS exception_type,
               'Lead requires manual qualification review' AS description,
               received_at AS created_at
        FROM intake_log
        WHERE client_id = $1 AND qualification_tier = 'pending_review'
        ORDER BY received_at DESC LIMIT 50
      `, [client_id]),

      query(`
        SELECT 'documents' AS automation, document_id AS record_id,
               file_name AS contact_name, NULL AS contact_email,
               processing_status AS status, confidence_score AS qualification_score,
               processing_status AS exception_type,
               CASE processing_status
                 WHEN 'human_review' THEN 'Document classification confidence too low for auto-processing'
                 WHEN 'pending_review' THEN 'Document flagged for manual review'
                 ELSE 'Document requires attention'
               END AS description,
               processed_at AS created_at
        FROM document_log
        WHERE client_id = $1 AND processing_status IN ('human_review','pending_review')
        ORDER BY processed_at DESC LIMIT 50
      `, [client_id]),

      query(`
        SELECT 'appointments' AS automation, appointment_id AS record_id,
               contact_name, contact_email, status,
               NULL AS qualification_score,
               status AS exception_type,
               CASE status
                 WHEN 'pending_review' THEN 'Appointment requires staff confirmation'
                 WHEN 'pending' THEN 'Appointment awaiting confirmation'
                 ELSE 'Appointment needs attention'
               END AS description,
               received_at AS created_at
        FROM appointment_log
        WHERE client_id = $1 AND status IN ('pending_review','pending')
        ORDER BY received_at DESC LIMIT 50
      `, [client_id]),

      query(`
        SELECT 'system' AS automation, execution_id AS record_id,
               workflow_name AS contact_name, NULL AS contact_email,
               run_status AS status, NULL AS qualification_score,
               'workflow_failure' AS exception_type,
               'Workflow execution failed — check run logs for details' AS description,
               started_at AS created_at
        FROM workflow_runs
        WHERE client_id = $1 AND run_status = 'failure'
          AND started_at > NOW() - INTERVAL '7 days'
        ORDER BY started_at DESC LIMIT 20
      `, [client_id]),
    ]);

    const all = [...intakeExceptions, ...docExceptions, ...apptExceptions, ...failedRuns]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(all);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load exceptions' });
  }
});

export default router;
