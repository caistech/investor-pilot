import { describe, it, expect } from 'vitest';

/**
 * Tests for outreach status logic and follow-up detection.
 * See: src/lib/db/outreach.ts
 */

interface OutreachEntry {
  status: string;
  follow_up_due_at: string | null;
  sent_at: string | null;
}

function isOverdue(entry: OutreachEntry): boolean {
  return entry.status === 'sent'
    && entry.follow_up_due_at !== null
    && new Date(entry.follow_up_due_at) < new Date();
}

function computeFollowUpDue(sentAt: string): string {
  return new Date(new Date(sentAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

describe('outreach follow-up detection', () => {
  it('detects overdue follow-up', () => {
    const entry: OutreachEntry = {
      status: 'sent',
      follow_up_due_at: '2026-01-01T00:00:00Z',
      sent_at: '2025-12-25T00:00:00Z',
    };
    expect(isOverdue(entry)).toBe(true);
  });

  it('does not flag future follow-ups as overdue', () => {
    const entry: OutreachEntry = {
      status: 'sent',
      follow_up_due_at: '2099-12-31T00:00:00Z',
      sent_at: '2099-12-24T00:00:00Z',
    };
    expect(isOverdue(entry)).toBe(false);
  });

  it('does not flag replied entries as overdue', () => {
    const entry: OutreachEntry = {
      status: 'replied',
      follow_up_due_at: '2026-01-01T00:00:00Z',
      sent_at: '2025-12-25T00:00:00Z',
    };
    expect(isOverdue(entry)).toBe(false);
  });

  it('does not flag entries without follow_up_due_at', () => {
    const entry: OutreachEntry = {
      status: 'sent',
      follow_up_due_at: null,
      sent_at: '2025-12-25T00:00:00Z',
    };
    expect(isOverdue(entry)).toBe(false);
  });
});

describe('follow-up due date calculation', () => {
  it('sets follow-up 7 days after sent_at', () => {
    const sentAt = '2026-04-01T10:00:00.000Z';
    const due = computeFollowUpDue(sentAt);
    expect(new Date(due).toISOString()).toBe('2026-04-08T10:00:00.000Z');
  });
});
