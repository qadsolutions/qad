import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const router = Router();
const __dir = dirname(fileURLToPath(import.meta.url));

router.get('/', (req, res) => {
  const clientId = req.query.client_id || 'acme_corp';
  if (!/^[a-z0-9_-]+$/i.test(clientId)) {
    return res.status(400).json({ error: 'Invalid client_id' });
  }
  try {
    const raw = readFileSync(join(__dir, `../config/${clientId}.json`), 'utf8');
    res.json(JSON.parse(raw));
  } catch {
    res.status(404).json({ error: `Config not found for client: ${clientId}` });
  }
});

export default router;
