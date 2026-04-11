import { describe, it, expect } from 'vitest';

/**
 * Tests for the domain normalization logic used in save_contact and save_draft.
 * These are pure function extractions of the matching logic in src/lib/agent/tools.ts.
 */

function normalizeDomain(raw: string): string {
  return (raw || '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function extractCompanyHint(domain: string): string {
  return domain.split('.')[0];
}

describe('domain normalization', () => {
  it('strips www prefix', () => {
    expect(normalizeDomain('www.dsmconsulting.com.au')).toBe('dsmconsulting.com.au');
  });

  it('strips trailing paths', () => {
    expect(normalizeDomain('dsmconsulting.com.au/about')).toBe('dsmconsulting.com.au');
  });

  it('strips both www and paths', () => {
    expect(normalizeDomain('www.example.com/page/sub')).toBe('example.com');
  });

  it('handles empty string', () => {
    expect(normalizeDomain('')).toBe('');
  });

  it('handles already-clean domain', () => {
    expect(normalizeDomain('dsmconsulting.com.au')).toBe('dsmconsulting.com.au');
  });
});

describe('company name extraction from domain', () => {
  it('extracts company hint from standard domain', () => {
    expect(extractCompanyHint('dsmconsulting.com.au')).toBe('dsmconsulting');
  });

  it('extracts company hint from short domain', () => {
    expect(extractCompanyHint('xero.com')).toBe('xero');
  });

  it('handles empty domain', () => {
    expect(extractCompanyHint('')).toBe('');
  });
});
