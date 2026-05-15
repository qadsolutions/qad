import { describe, it, expect } from 'vitest';

// Extract the clamping logic from reports.js for isolated testing
function clampDays(range) {
  return Math.min(Math.max(parseInt(range) || 30, 1), 365);
}

describe('reports.js — range clamping', () => {
  it('defaults to 30 when range is omitted', () => {
    expect(clampDays(undefined)).toBe(30);
  });

  it('defaults to 30 when range is NaN', () => {
    expect(clampDays('foo')).toBe(30);
  });

  it('treats zero as the default (parseInt 0 is falsy)', () => {
    // '0' → parseInt gives 0 → 0 || 30 = 30 (falls to default, not floor)
    expect(clampDays('0')).toBe(30);
  });

  it('clamps negative to 1 (negative is truthy so || default skips)', () => {
    expect(clampDays('-5')).toBe(1);
  });

  it('passes through a valid value', () => {
    expect(clampDays('30')).toBe(30);
    expect(clampDays('7')).toBe(7);
    expect(clampDays('90')).toBe(90);
  });

  it('clamps 365 exactly (boundary)', () => {
    expect(clampDays('365')).toBe(365);
  });

  it('clamps 366 down to 365', () => {
    expect(clampDays('366')).toBe(365);
  });

  it('clamps very large value to 365', () => {
    expect(clampDays('99999')).toBe(365);
  });
});
