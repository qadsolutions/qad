import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { client_id = 'acme_corp', status, file_type, limit = '50', offset = '0' } = req.query;
  const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 500);
  const safeOffset = Math.max(parseInt(offset) || 0, 0);
  try {
    const conditions = ['client_id = $1'];
    const params = [client_id];
    let i = 2;

    if (status) { conditions.push(`processing_status = $${i++}`); params.push(status); }
    if (file_type) { conditions.push(`file_type = $${i++}`); params.push(file_type); }
    params.push(safeLimit, safeOffset);

    const rows = await query(`
      SELECT document_id, client_id, file_name, file_type,
             classification_label, confidence_score, processing_status,
             downstream_action, downstream_action AS routing_destination,
             filing_target, extracted_fields, processed_at, source_type
      FROM document_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY processed_at DESC
      LIMIT $${i++} OFFSET $${i}
    `, params);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

router.get('/:documentId', async (req, res) => {
  const { client_id = 'acme_corp' } = req.query;
  const { documentId } = req.params;
  try {
    const rows = await query(`
      SELECT * FROM document_log
      WHERE document_id = $1 AND client_id = $2
    `, [documentId, client_id]);
    if (!rows.length) return res.status(404).json({ error: 'Document not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load document' });
  }
});

export default router;
