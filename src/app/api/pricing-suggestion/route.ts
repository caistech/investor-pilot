/**
 * POST /api/pricing-suggestion
 *
 * Capture "what would this be worth to you?" responses from /pricing
 * and email them to the founder for market-pricing intel. Public
 * endpoint (no auth) — gated by basic per-IP rate limiting and a
 * Cloudflare-style honeypot field. Real prices are not set yet; this
 * is the placeholder UI for collecting WTP signal.
 *
 * Body:
 *   {
 *     suggested_price: string  // free-text — operator's own framing
 *     use_case?: string        // optional context: "raising Series A", "B2B SaaS sales"
 *     email?: string           // optional, only if they want a reply when pricing lands
 *     hp?: string              // honeypot — bots fill this, humans don't
 *   }
 *
 * Recipient: hardcoded to FOUNDER_EMAIL below — founder's choice.
 * Replies-to is set to the respondent's email when provided so the
 * founder can reply directly without copying addresses around.
 */

import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/resend';

export const runtime = 'nodejs';

// Where pricing-suggestion responses land. Wired to Dennis directly
// because this is market-research signal he wants to skim personally,
// not aggregated dashboard data.
const FOUNDER_EMAIL = 'dennis@factory2key.com.au';

// Per-IP throttle. Held in-memory, resets on cold start — good enough
// for an unauthenticated form that gets at most a few responses per day.
// Maps ip → unix ms of last accepted submission.
const lastSubmissionByIp = new Map<string, number>();
const THROTTLE_MS = 30_000; // one submission per IP per 30s

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Honeypot — bots will fill `hp` because it's a normal-looking text
  // field, humans never see it. Reject silently with a 200 so the bot
  // doesn't retry differently.
  if (typeof body.hp === 'string' && body.hp.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  const suggestedPrice = typeof body.suggested_price === 'string' ? body.suggested_price.trim() : '';
  const useCase = typeof body.use_case === 'string' ? body.use_case.trim() : '';
  const respondentEmail = typeof body.email === 'string' ? body.email.trim() : '';

  if (!suggestedPrice) {
    return NextResponse.json({ error: 'suggested_price required' }, { status: 400 });
  }
  if (suggestedPrice.length > 500) {
    return NextResponse.json({ error: 'suggested_price too long (500 char max)' }, { status: 400 });
  }
  if (useCase.length > 500) {
    return NextResponse.json({ error: 'use_case too long (500 char max)' }, { status: 400 });
  }
  if (respondentEmail.length > 200) {
    return NextResponse.json({ error: 'email too long' }, { status: 400 });
  }
  if (respondentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(respondentEmail)) {
    return NextResponse.json({ error: 'email looks invalid' }, { status: 400 });
  }

  // Throttle by IP. Vercel surfaces the client IP via x-forwarded-for;
  // fall back to a constant key when missing (local dev) so the throttle
  // still self-rate-limits a runaway test loop.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const lastAt = lastSubmissionByIp.get(ip) || 0;
  if (now - lastAt < THROTTLE_MS) {
    return NextResponse.json(
      { error: 'Slow down — one suggestion per 30 seconds. Yours is appreciated, no need to resend.' },
      { status: 429 },
    );
  }
  lastSubmissionByIp.set(ip, now);

  const subject = `[InvestorPilot pricing] "${suggestedPrice.slice(0, 60)}${suggestedPrice.length > 60 ? '…' : ''}"`;
  const textBody = [
    'New pricing suggestion received via /pricing form.',
    '',
    `Suggested price: ${suggestedPrice}`,
    useCase ? `Use case:        ${useCase}` : null,
    respondentEmail ? `Respondent email: ${respondentEmail} (also set as reply-to)` : 'Respondent email: (not provided)',
    `Submitted from IP: ${ip}`,
    `At: ${new Date().toISOString()}`,
  ].filter(Boolean).join('\n');

  const sendResult = await sendEmail({
    to: FOUNDER_EMAIL,
    subject,
    body: textBody,
    replyTo: respondentEmail || undefined,
  });

  if (sendResult.error) {
    return NextResponse.json(
      { error: `Failed to forward suggestion: ${sendResult.error}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, message_id: sendResult.id });
}
