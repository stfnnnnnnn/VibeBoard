import type { NextAuthConfig } from 'next-auth';

const PROTECTED  = ['/dashboard', '/studypulse', '/finance', '/habits'];
const AUTH_PAGES = ['/', '/login', '/signup'];

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

      // Redirect authenticated users away from auth/landing pages
      if (isLoggedIn && AUTH_PAGES.includes(path)) {
        return Response.redirect(new URL('/dashboard', nextUrl));
      }

      return true;
    },
  },
};
