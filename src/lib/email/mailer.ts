/* Sends transactional email from a Gmail account via an App Password (spec D8). Swap this module for
   Resend once a domain exists. Never throws to callers: auth flows must not fail because email did. */
import nodemailer from 'nodemailer';
import type { MailContent } from '@/lib/email/templates';

let transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  transport ??= nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return transport;
}

export async function sendMail(m: MailContent & { to: string }): Promise<boolean> {
  const t = getTransport();
  if (!t) {
    if (process.env.NODE_ENV === 'production') {
      // Recipient redacted to its domain: production logs must not collect addresses.
      console.error(`[mail] GMAIL_USER / GMAIL_APP_PASSWORD not set; "${m.subject}" to *@${m.to.split('@').pop()} was not sent`);
    } else {
      console.log(`\n[mail:dev] to=${m.to} subject="${m.subject}"\n${m.text}\n`);
    }
    return false;
  }
  try {
    await t.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'VibeBoard'}" <${process.env.GMAIL_USER}>`,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
    });
    return true;
  } catch (err) {
    console.error('[mail] send failed:', err);
    return false;
  }
}
