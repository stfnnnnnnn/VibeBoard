import { after, type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { createUser, findByEmail } from '@/lib/auth/users';
import { issueToken } from '@/lib/auth/authTokens';
import { VERIFY_TTL_MIN } from '@/lib/auth/tokens';
import { cleanEmail, cleanName, emailError, nameError, passwordError } from '@/lib/auth/validate';
import { sendMail } from '@/lib/email/mailer';
import { verifyMail, absoluteUrl } from '@/lib/email/templates';

/* Email + password sign-up (spec §4.5). Google sign-ups never come through here: any `google` flag in
   the body is ignored, and a password is always required. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: 'Invalid request.' }, { status: 400 });

  const first = cleanName(body.first_name);
  const last = cleanName(body.last_name);
  const email = cleanEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  const errors: Record<string, string> = {};
  const e1 = nameError(first, 'first name'); if (e1) errors.first_name = e1;
  const e2 = nameError(last, 'last name');   if (e2) errors.last_name = e2;
  const e3 = emailError(email);              if (e3) errors.email = e3;
  const e4 = passwordError(password);        if (e4) errors.password = e4;
  if (Object.keys(errors).length) return Response.json({ errors }, { status: 400 });

  if (await findByEmail(email)) return Response.json({ code: 'email-taken' }, { status: 409 });

  let userId: number;
  try {
    userId = await createUser({
      first_name: first, surname: last, email, password_hash: await bcrypt.hash(password, 12),
      google_sub: null, email_verified: false, year_level: null,
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return Response.json({ code: 'email-taken' }, { status: 409 });
    console.error('[signup] DB error:', err);
    return Response.json({ error: 'Something went wrong on our side. Please try again.' }, { status: 500 });
  }

  after(async () => {
    const token = await issueToken(userId, 'verify', VERIFY_TTL_MIN);
    if (token) await sendMail({ to: email, ...verifyMail({ firstName: first, url: absoluteUrl(`/verify-email?token=${token}`) }) });
  });

  return Response.json({ ok: true }, { status: 201 });
}
