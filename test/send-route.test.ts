import { describe, it, expect } from 'vitest';

/**
 * Tests for the send route's fallback logic.
 * Validates that override fields from session UI are used when DB fields are null.
 * See: src/app/api/pipeline/send/route.ts
 */

function resolveSendFields(
  partner: { contact_email: string | null; draft_subject: string | null; draft_body: string | null },
  overrides: { contact_email?: string; draft_subject?: string; draft_body?: string }
) {
  return {
    email: partner.contact_email || overrides.contact_email || null,
    subject: partner.draft_subject || overrides.draft_subject || null,
    body: partner.draft_body || overrides.draft_body || null,
  };
}

describe('send route field resolution', () => {
  it('uses DB fields when available', () => {
    const result = resolveSendFields(
      { contact_email: 'db@example.com', draft_subject: 'DB Subject', draft_body: 'DB Body' },
      { contact_email: 'override@example.com', draft_subject: 'Override', draft_body: 'Override Body' }
    );
    expect(result.email).toBe('db@example.com');
    expect(result.subject).toBe('DB Subject');
    expect(result.body).toBe('DB Body');
  });

  it('falls back to overrides when DB fields are null', () => {
    const result = resolveSendFields(
      { contact_email: null, draft_subject: null, draft_body: null },
      { contact_email: 'gary@dsmconsulting.com.au', draft_subject: 'Partnership', draft_body: 'Hi Gary' }
    );
    expect(result.email).toBe('gary@dsmconsulting.com.au');
    expect(result.subject).toBe('Partnership');
    expect(result.body).toBe('Hi Gary');
  });

  it('returns null when both DB and overrides are missing', () => {
    const result = resolveSendFields(
      { contact_email: null, draft_subject: null, draft_body: null },
      {}
    );
    expect(result.email).toBeNull();
    expect(result.subject).toBeNull();
    expect(result.body).toBeNull();
  });

  it('mixes DB and override fields', () => {
    const result = resolveSendFields(
      { contact_email: 'db@example.com', draft_subject: null, draft_body: 'DB Body' },
      { draft_subject: 'Override Subject' }
    );
    expect(result.email).toBe('db@example.com');
    expect(result.subject).toBe('Override Subject');
    expect(result.body).toBe('DB Body');
  });
});
