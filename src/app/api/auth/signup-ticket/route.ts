import { NextResponse, type NextRequest } from 'next/server';
import { openTicket, TICKET_COOKIE, ticketCookieOptions } from '@/lib/auth/ticket';

/* The OAuth signIn callback redirects new Google users here with the sealed ticket. We set it as an
   httpOnly cookie (our own handler, so cookie writes are reliable) and continue to /signup/finish. */
export async function GET(req: NextRequest) {
  const sealed = req.nextUrl.searchParams.get('t');
  const ticket = await openTicket(sealed);
  if (!sealed || !ticket) return NextResponse.redirect(new URL('/signup?e=ticket', req.url));
  const res = NextResponse.redirect(new URL('/signup/finish', req.url));
  res.cookies.set(TICKET_COOKIE, sealed, ticketCookieOptions);
  return res;
}

/** "Not you?" / "Cancel" on the finish page, and cleanup after a successful finish. */
export async function DELETE() {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(TICKET_COOKIE, '', { ...ticketCookieOptions, maxAge: 0 });
  return res;
}
