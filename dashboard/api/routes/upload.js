import { Router } from 'express';

const router = Router();

const N8N_URL = process.env.N8N_URL || 'http://localhost:5678';

router.post('/', async (req, res) => {
  const {
    client_id = 'acme_corp',
    file_name,
    file_type,
    file_size,
    file_content_base64,
    document_text,
    sender,
    subject,
    metadata = {},
  } = req.body;

  if (!file_name) {
    return res.status(400).json({ error: 'file_name is required' });
  }

  const payload = {
    client_id,
    source_type: 'upload',
    sender: sender || 'portal_user',
    subject: subject || `Upload: ${file_name}`,
    file_name,
    file_type: file_type || file_name.split('.').pop().toLowerCase(),
    file_size,
    file_content_base64,
    document_text,
    metadata,
  };

  try {
    const resp = await fetch(`${N8N_URL}/webhook/document-intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { raw: text }; }

    if (!resp.ok) {
      return res.status(resp.status).json({ error: result.message || 'Automation rejected the document', detail: result });
    }

    res.json(result);
  } catch (err) {
    console.error('Upload proxy error:', err.message);
    res.status(502).json({ error: 'Could not reach the document automation. Is n8n running?' });
  }
});

export default router;
