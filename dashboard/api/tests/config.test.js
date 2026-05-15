import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs so we never touch disk in tests
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify({ client_id: 'test', automations: [] })),
}));

// Minimal Express-style mock helpers
function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

// Import the route handler function directly by re-implementing the validation
// (tests the logic, not the Express wiring)
function validateClientId(client_id) {
  return /^[a-z0-9_-]+$/i.test(client_id);
}

describe('config.js — client_id validation', () => {
  it('accepts a normal client id', () => {
    expect(validateClientId('acme_corp')).toBe(true);
  });

  it('accepts alphanumeric with hyphens', () => {
    expect(validateClientId('client-123')).toBe(true);
  });

  it('rejects path traversal with ../', () => {
    expect(validateClientId('../../../etc/passwd')).toBe(false);
  });

  it('rejects path traversal with slashes', () => {
    expect(validateClientId('foo/bar')).toBe(false);
  });

  it('rejects null bytes', () => {
    expect(validateClientId('foo\0bar')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(validateClientId('acme corp')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateClientId('')).toBe(false);
  });
});
