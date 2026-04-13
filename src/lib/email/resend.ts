import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

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
