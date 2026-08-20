import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import pool from '@/lib/db';
import { authConfig } from '@/auth.config';
import type { RowDataPacket } from 'mysql2';

/* ── DB row types ─────────────────────────────────────────── */

interface AuthRow extends RowDataPacket {
  user_id:         number;
  password:        string;
  first_name:      string;
  failed_attempts: number;
  last_attempt:    string | null;
}

interface LookupRow extends RowDataPacket {
  user_id:    number;
  first_name: string;
}

/* ── Helpers ──────────────────────────────────────────────── */

/**
 * Looks up an existing user by email for Google sign-in.
 * Returns { id, name } if found, null if this is a first-time Google user
 * (in which case the signIn callback redirects them to /signup to enter
 * their own details instead of auto-creating a placeholder record).
 */
async function findGoogleUser(
  email: string,
): Promise<{ id: string; name: string } | null> {
  try {
    const [rows] = await pool.execute<LookupRow[]>(
      'SELECT user_id, first_name FROM user_login WHERE email = ?',
      [email],
    );
    if (rows.length === 0) return null;
    return { id: String(rows[0].user_id), name: rows[0].first_name };
  } catch (err) {
    console.error('[auth] findGoogleUser error:', err);
    return null;
  }
}

/* ── Main auth config ─────────────────────────────────────── */

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    Google({
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),

    Credentials({
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email    = typeof credentials?.email    === 'string' ? credentials.email.trim().toLowerCase()    : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';

        if (!email || !password) return null;

        try {
          const [rows] = await pool.execute<AuthRow[]>(
            `SELECT user_id, password, first_name, failed_attempts, last_attempt
               FROM user_login WHERE email = ?`,
            [email],
          );
          if (rows.length === 0) return null;

          const user = rows[0];

          // 5-attempt lock for 10 minutes
          if (user.failed_attempts >= 5 && user.last_attempt) {
            const elapsed = Date.now() - new Date(user.last_attempt).getTime();
            if (elapsed < 10 * 60 * 1000) return null;
          }

          const valid = await bcrypt.compare(password, user.password);
          if (!valid) {
            await pool.execute(
              `UPDATE user_login
                  SET failed_attempts = failed_attempts + 1, last_attempt = NOW()
                WHERE user_id = ?`,
              [user.user_id],
            );
            return null;
          }

          await pool.execute(
            `UPDATE user_login SET failed_attempts = 0, last_attempt = NULL WHERE user_id = ?`,
            [user.user_id],
          );

          return { id: String(user.user_id), name: user.first_name, email };
        } catch (err) {
          console.error('[auth] credentials authorize error:', err);
          return null;
        }
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        if (!user.email) return false;

        const existing = await findGoogleUser(user.email.toLowerCase());
        if (!existing) {
          // No account for this Google email — send them to the signup
          // form to enter their own details instead of creating one for them.
          const params = new URLSearchParams({
            google: '1',
            email:  user.email.toLowerCase(),
            name:   user.name ?? '',
          });
          return `/signup?${params.toString()}`;
        }
      }
      return true;
    },

    async jwt({ token, user, account }) {
      if (account?.provider === 'credentials' && user) {
        // user.id comes from authorize(); store as JWT subject
        token.sub  = user.id!;
        token.name = user.name ?? undefined;
      } else if (account?.provider === 'google' && user?.email) {
        // account is only present on first sign-in — this DB call runs once per login.
        // The signIn callback above already guarantees the user exists at this point.
        const dbUser = await findGoogleUser(user.email.toLowerCase());
        if (dbUser) {
          token.sub  = dbUser.id;   // our DB user_id, not Google's subject
          token.name = dbUser.name;
        }
      }
      return token;
    },

    session({ session, token }) {
      if (token.sub)  session.user.id   = token.sub;
      if (token.name) session.user.name = token.name;
      return session;
    },
  },
});
