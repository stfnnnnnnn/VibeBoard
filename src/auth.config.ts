import type { NextAuthConfig } from 'next-auth';

const PROTECTED = ['/dashboard', '/studypulse', '/finance', '/habits', '/workboard'];

// The "signed-in users are sent to /dashboard" bounce for /, /login, /signup,
// /signup/finish and /forgot-password lives in those pages (`await auth()`),
// not here. This middleware is edge-safe and never re-checks session_version,
// so for a revoked session it still sees a user while the pages' auth() sees
// none: bouncing here would loop /dashboard -> /login -> /dashboard forever.

export const authConfig: NextAuthConfig = {
  providers: [],
  pages: {
    signIn: '/login',
    error:  '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const path       = nextUrl.pathname;

      // Redirect unauthenticated users away from protected pages
      if (PROTECTED.some((p) => path.startsWith(p)) && !isLoggedIn) {
        return false; // NextAuth redirects to pages.signIn
      }

      return true;
    },
  },
};
