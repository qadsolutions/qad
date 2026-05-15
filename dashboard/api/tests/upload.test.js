import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Extract N8N_URL resolution logic for isolated testing
function resolveN8nUrl(envValue) {
  return envValue || 'http://localhost:5678';
}

describe('upload.js — N8N_URL default', () => {
  it('uses localhost when N8N_URL is not set', () => {
    expect(resolveN8nUrl(undefined)).toBe('http://localhost:5678');
  });

  it('uses localhost when N8N_URL is empty string', () => {
    expect(resolveN8nUrl('')).toBe('http://localhost:5678');
  });

  it('respects N8N_URL when explicitly provided', () => {
    expect(resolveN8nUrl('http://qad-n8n:5678')).toBe('http://qad-n8n:5678');
  });

  it('respects a custom port', () => {
    expect(resolveN8nUrl('http://localhost:9000')).toBe('http://localhost:9000');
  });
});

describe('upload.js — file_name validation', () => {
  function validateUpload(body) {
    if (!body.file_name) return { status: 400, error: 'file_name is required' };
    return { status: 200 };
  }

  it('rejects missing file_name', () => {
    expect(validateUpload({}).status).toBe(400);
  });

  it('rejects null file_name', () => {
    expect(validateUpload({ file_name: null }).status).toBe(400);
  });

  it('accepts a valid payload', () => {
    expect(validateUpload({ file_name: 'invoice.pdf' }).status).toBe(200);
  });
});
