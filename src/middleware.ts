import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// auth.config.ts is edge-safe (no mysql2 / Node.js stream imports).
// The full auth.ts (with mysql2) is only imported in API routes and server components.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
