import { NextResponse, type NextRequest } from 'next/server';
import { verifyGoogleIdToken } from '@/lib/auth/googleIdToken';
import { resolveGoogle } from '@/lib/auth/resolveGoogle';
import { sealTicket, TICKET_COOKIE, ticketCookieOptions } from '@/lib/auth/ticket';

/* GIS button callback, step 1 (spec §4.3). Existing users: the client then calls
   signIn('google-idtoken'). New users: we set the ticket and the client goes to /signup/finish. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { credential?: unknown } | null;
  const id = await verifyGoogleIdToken(typeof body?.credential === 'string' ? body.credential : '');
  if (!id) return NextResponse.json({ code: 'google' }, { status: 400 });
  const out = await resolveGoogle(id);
  if (out.kind === 'user') return NextResponse.json({ status: 'existing' });
  if (out.kind === 'new') {
    const res = NextResponse.json({ status: 'new' });
    res.cookies.set(TICKET_COOKIE, await sealTicket(out.ticket), ticketCookieOptions);
    return res;
  }
  return NextResponse.json({ code: out.kind === 'conflict' ? 'google-conflict' : 'google-unverified' }, { status: 400 });
}
