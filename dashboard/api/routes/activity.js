import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const {
    client_id = 'acme_corp',
    automation,
    status,
    limit = '50',
    offset = '0',
  } = req.query;

  try {
    const conditions = ['client_id = $1'];
    const params = [client_id];
    let i = 2;

    if (automation) {
      conditions.push(`automation = $${i++}`);
      params.push(automation);
    }
    if (status) {
      conditions.push(`status = $${i++}`);
      params.push(status);
    }

    params.push(parseInt(limit), parseInt(offset));

    const rows = await query(`
      SELECT automation, record_id, client_id, source_type, status,
             contact_email, service_type, activity_time, processed_at
      FROM v_recent_activity
      WHERE ${conditions.join(' AND ')}
      ORDER BY activity_time DESC
      LIMIT $${i++} OFFSET $${i}
    `, params);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

export default router;
