/**
 * Pipeline Signal Emitter
 * Sends market signals back to Corporate AI Solutions pipeline
 * for LIVE/DIE decision making.
 */

import { createHmac } from 'node:crypto';

interface SignalPayload {
  product_id: string;
  signal_type: 'cta_click' | 'form_submit' | 'meeting_booked' | 'reply_received';
  source: 'distributor' | 'end_user';
  contact_email?: string;
  contact_name?: string;
  company_name?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export async function emitSignal(signal: Omit<SignalPayload, 'timestamp'>): Promise<boolean> {
  const webhookUrl = process.env.PIPELINE_SIGNAL_WEBHOOK_URL;
  const webhookSecret = process.env.PIPELINE_SIGNAL_WEBHOOK_SECRET;

  if (!webhookUrl || !webhookSecret) {
    console.warn('[signals] PIPELINE_SIGNAL_WEBHOOK_URL or secret not configured, skipping signal');
    return false;
  }

  const payload: SignalPayload = {
    ...signal,
    timestamp: new Date().toISOString(),
  };

  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signal-Signature': `sha256=${signature}`,
      },
      body: rawBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[signals] Signal emit failed:', response.status, errorText);
      return false;
    }

    console.log('[signals] Emitted', signal.signal_type, 'for', signal.product_id);
    return true;
  } catch (err) {
    console.error('[signals] Signal emit error:', err);
    return false;
  }
}

export async function emitReplyReceived(
  productId: string,
  contactEmail: string,
  contactName?: string,
  companyName?: string
): Promise<boolean> {
  return emitSignal({
    product_id: productId,
    signal_type: 'reply_received',
    source: 'distributor',
    contact_email: contactEmail,
    contact_name: contactName,
    company_name: companyName,
  });
}

export async function emitMeetingBooked(
  productId: string,
  contactEmail: string,
  contactName?: string,
  companyName?: string,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  return emitSignal({
    product_id: productId,
    signal_type: 'meeting_booked',
    source: 'distributor',
    contact_email: contactEmail,
    contact_name: contactName,
    company_name: companyName,
    metadata,
  });
}
