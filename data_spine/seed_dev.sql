-- ============================================================
-- Development seed data — run after data_spine.sql
-- DO NOT run in production.
-- ============================================================

INSERT INTO clients (client_id, client_name, industry, timezone, notes)
VALUES
  ('acme_corp',   'Acme Corp',        'General Business', 'America/Chicago', 'Test client for development.'),
  ('default',     'Default Client',   NULL,               'UTC',             'Auto-seeded fallback client.')
ON CONFLICT (client_id) DO NOTHING;
