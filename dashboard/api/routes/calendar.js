import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { client_id = 'acme_corp', status, from, to } = req.query;
  try {
    const conditions = ['client_id = $1'];
    const params = [client_id];
    let i = 2;

    if (status) { conditions.push(`status = $${i++}`); params.push(status); }
    if (from)   { conditions.push(`confirmed_time >= $${i++}`); params.push(from); }
    if (to)     { conditions.push(`confirmed_time <= $${i++}`); params.push(to); }

    const rows = await query(`
      SELECT appointment_id, client_id, contact_name, contact_email,
             service_type, confirmed_time AS appointment_time, timezone, status,
             auto_confirmed, reminder_sequence, source_type, created_at
      FROM appointment_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY confirmed_time ASC
      LIMIT 200
    `, params);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load calendar' });
  }
});

router.get('/:appointmentId', async (req, res) => {
  const { client_id = 'acme_corp' } = req.query;
  const { appointmentId } = req.params;
  try {
    const rows = await query(`
      SELECT * FROM appointment_log
      WHERE appointment_id = $1 AND client_id = $2
    `, [appointmentId, client_id]);
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load appointment' });
  }
});

export default router;
