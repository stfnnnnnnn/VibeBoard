import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    /** user_login.session_version when this token was issued (spec §4.8). */
    sv?: number;
    /** Epoch ms of the last session_version check. */
    svAt?: number;
  }
}
