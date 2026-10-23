import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { authConfig } from '@/auth.config';
import {
  findByEmail, findByGoogleSub, findById, createUser, recordFailedLogin, clearFailedLogins,
  getSessionVersion, type AuthUser,
} from '@/lib/auth/users';
import { resolveGoogle } from '@/lib/auth/resolveGoogle';
import { verifyGoogleIdToken } from '@/lib/auth/googleIdToken';
import { sealTicket, openTicket, ticketFromCookieHeader } from '@/lib/auth/ticket';
import { resetPassword } from '@/lib/auth/authTokens';
import { cleanEmail, cleanName, nameError, passwordError, yearLevelFor } from '@/lib/auth/validate';
import { lockSecondsLeft, MAX_ATTEMPTS, LOCK_SECONDS } from '@/lib/auth/lockout';

/* ── Errors: the code reaches the client as SignInResponse.code (redirect: false) ── */

class AuthCodeError extends CredentialsSignin {
  constructor(code: string) {
    super();
    this.code = code;
  }
}

const svRecheckEnv = Number(process.env.AUTH_SV_RECHECK_MS);
const SV_RECHECK_MS = Number.isFinite(svRecheckEnv) && svRecheckEnv >= 0 ? svRecheckEnv : 5 * 60 * 1000;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const asUser = (u: AuthUser) => ({ id: String(u.user_id), name: u.first_name, email: u.email });

// Compared against when the email is unknown, so both paths cost one bcrypt compare (no timing oracle).
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('vibeboard-timing-equalizer', 12));

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),

    Credentials({
      id: 'credentials',
      credentials: { email: {}, password: {} },
      async authorize(c) {
        const email = cleanEmail(c?.email);
        const password = str(c?.password);
        if (!email || !password) throw new AuthCodeError('invalid');
        const u = await findByEmail(email);
        if (!u || !u.password) {
          await bcrypt.compare(password, await getDummyHash());
          throw new AuthCodeError('invalid');
        }
        const left = lockSecondsLeft(u.failed_attempts, u.since_last_attempt);
        if (left > 0) throw new AuthCodeError(`locked:${left}`);
        if (!(await bcrypt.compare(password, u.password))) {
          await recordFailedLogin(u.user_id);
          if (u.failed_attempts + 1 >= MAX_ATTEMPTS) throw new AuthCodeError(`locked:${LOCK_SECONDS}`);
          throw new AuthCodeError('invalid');
        }
        await clearFailedLogins(u.user_id);
        return asUser(u);
      },
    }),

    Credentials({
      id: 'google-idtoken',
      credentials: { credential: {} },
      async authorize(c) {
        const id = await verifyGoogleIdToken(str(c?.credential));
        if (!id) throw new AuthCodeError('google');
        const out = await resolveGoogle(id);
        if (out.kind === 'user') return asUser(out.user);
        throw new AuthCodeError(out.kind === 'new' ? 'needs-finish' : out.kind === 'conflict' ? 'google-conflict' : 'google-unverified');
      },
    }),

    Credentials({
      id: 'google-finish',
      credentials: { first_name: {}, last_name: {}, year: {} },
      async authorize(c, request) {
        const ticket = await openTicket(ticketFromCookieHeader(request.headers.get('cookie')));
        if (!ticket) throw new AuthCodeError('ticket');
        const first = cleanName(c?.first_name);
        const last = cleanName(c?.last_name);
        if (nameError(first, 'first name') || nameError(last, 'last name')) throw new AuthCodeError('name');
        const identity = { ...ticket, email_verified: true };
        const out = await resolveGoogle(identity);
        // A leftover ticket (e.g. on a shared PC) must never sign someone into an existing account without Google.
        if (out.kind !== 'new') throw new AuthCodeError('ticket');
        try {
          const id = await createUser({
            first_name: first, surname: last, email: ticket.email, password_hash: null,
            google_sub: ticket.sub, email_verified: true, year_level: yearLevelFor(c?.year),
          });
          return { id: String(id), name: first, email: ticket.email };
        } catch (err) {
          if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
            const again = await resolveGoogle(identity); // a parallel submit won the race
            if (again.kind === 'user') return asUser(again.user);
          }
          throw err;
        }
      },
    }),

    Credentials({
      id: 'password-reset',
      credentials: { token: {}, password: {} },
      async authorize(c) {
        const password = str(c?.password);
        if (passwordError(password)) throw new AuthCodeError('weak');
        const userId = await resetPassword(str(c?.token), await bcrypt.hash(password, 12));
        if (!userId) throw new AuthCodeError('reset-invalid');
        const u = await findById(userId);
        if (!u) throw new AuthCodeError('reset-invalid');
        return asUser(u);
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return true;
      const p = (profile ?? {}) as Record<string, unknown>;
      if (typeof p.sub !== 'string' || typeof p.email !== 'string') return '/login?e=google-unverified';
      const out = await resolveGoogle({
        sub: p.sub,
        email: p.email.toLowerCase(),
        email_verified: p.email_verified === true,
        given_name: str(p.given_name),
        family_name: str(p.family_name),
        picture: typeof p.picture === 'string' ? p.picture : null,
      });
      if (out.kind === 'user') return true;
      if (out.kind === 'new') return `/api/auth/signup-ticket?t=${encodeURIComponent(await sealTicket(out.ticket))}`;
      return `/login?e=${out.kind === 'conflict' ? 'google-conflict' : 'google-unverified'}`;
    },

    async jwt({ token, user, account }) {
      if (account && user) {
        const dbUser = account.provider === 'google'
          ? await findByGoogleSub(account.providerAccountId)
          : await findById(Number(user.id));
        if (!dbUser) return null;
        token.sub = String(dbUser.user_id);
        token.name = dbUser.first_name;
        token.email = dbUser.email;
        token.sv = dbUser.session_version;
        token.svAt = Date.now();
        return token;
      }
      if (!token.sub) return token;
      // Tokens issued before session_version existed carry no sv: they were issued at the column default 0,
      // and are checked immediately so a reset or password-clear since then still ends them.
      const tokenSv = typeof token.sv === 'number' ? token.sv : 0;
      const due = typeof token.sv !== 'number' || Date.now() - (token.svAt ?? 0) > SV_RECHECK_MS;
      if (due) {
        const sv = await getSessionVersion(Number(token.sub));
        if (sv === null || sv !== tokenSv) return null; // account deleted, or password reset/cleared elsewhere
        token.sv = sv;
        token.svAt = Date.now();
      }
      return token;
    },

    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      if (token.name) session.user.name = token.name;
      return session;
    },
  },
});
