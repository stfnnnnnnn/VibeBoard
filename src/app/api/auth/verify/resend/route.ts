import { after } from 'next/server';
import { auth } from '@/auth';
import { findById } from '@/lib/auth/users';
import { issueToken } from '@/lib/auth/authTokens';
import { VERIFY_TTL_MIN } from '@/lib/auth/tokens';
import { sendMail } from '@/lib/email/mailer';
import { verifyMail, absoluteUrl } from '@/lib/email/templates';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  const u = await findById(Number(session.user.id));
  if (!u) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  if (u.email_verified_at) return Response.json({ ok: true, already: true });
  const token = await issueToken(u.user_id, 'verify', VERIFY_TTL_MIN);
  if (!token) return Response.json({ code: 'cooldown' }, { status: 429 });
  after(() => sendMail({ to: u.email, ...verifyMail({ firstName: u.first_name, url: absoluteUrl(`/verify-email?token=${token}`) }) }).then(() => undefined));
  return Response.json({ ok: true });
}
