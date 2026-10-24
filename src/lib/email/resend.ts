import { Resend } from 'resend';

// Constructed inside sendEmail, not at module scope. `new Resend(undefined)` throws
// ("Missing API key"), and Next imports every route module while collecting page data for a build
// that has no runtime secrets — so a module-scope client turns a missing key at SEND time into a
// build failure for the whole app. Same class as src/lib/llm/client.ts.

interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}

export async function sendEmail({ to, subject, body, replyTo }: SendEmailParams): Promise<{ id?: string; error?: string }> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    return { error: 'RESEND_FROM_EMAIL not configured' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { error: 'RESEND_API_KEY not configured' };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      text: body,
      replyTo,
    });

    if (error) {
      return { error: error.message };
    }

    return { id: data?.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to send email' };
  }
}
