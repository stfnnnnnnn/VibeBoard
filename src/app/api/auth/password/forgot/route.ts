import { after, type NextRequest } from 'next/server';
import { findByEmail } from '@/lib/auth/users';
import { issueToken } from '@/lib/auth/authTokens';
import { RESET_TTL_MIN } from '@/lib/auth/tokens';
import { cleanEmail, emailError } from '@/lib/auth/validate';
import { sendMail } from '@/lib/email/mailer';
import { resetMail, googleAccountMail, absoluteUrl } from '@/lib/email/templates';

/* Always answers the same way, and does the lookup after the response, so it never reveals whether
   an account exists (spec §4.6). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = cleanEmail(body?.email);
  if (!emailError(email)) {
    after(async () => {
      const u = await findByEmail(email);
      if (!u) return;
      const token = await issueToken(u.user_id, 'reset', RESET_TTL_MIN);
      if (!token) return; // cooldown
      const p = { firstName: u.first_name, url: absoluteUrl(`/reset-password?token=${token}`), minutes: RESET_TTL_MIN };
      await sendMail({ to: u.email, ...(u.password ? resetMail(p) : googleAccountMail(p)) });
    });
  }
  return Response.json({ ok: true });
}
