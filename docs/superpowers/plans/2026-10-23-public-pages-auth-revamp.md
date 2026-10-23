# Public Pages and Auth Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the landing, login and sign-up pages in the approved pastel "page is a day" design, and make the auth backend correct. The backend work covers minimal sign-up, a Google sign-up ticket that leads to `/signup/finish`, Google's personalized button, password reset and email verification sent through Gmail, and session revocation.

**Architecture:**
- **Pages:** the public pages move into a `src/app/(public)` route group that shares one stylesheet (`public.css`) and an inline daypart script.
- **Pure logic:** lives in `src/lib/auth/*` and `src/lib/email/templates.ts`, with tests via `node:test`.
- **Database access:** goes through `src/lib/auth/users.ts` and `authTokens.ts`, behind an idempotent `ensureAuthV2Schema()`.
- **Auth.js:** gets five providers (Google OAuth, credentials, `google-idtoken`, `google-finish`, `password-reset`).
- **Sign-up ticket cookie:** written **only by our own route handlers** (`/api/auth/signup-ticket`, `/api/auth/google-onetap`), never inside Auth.js callbacks.

**Tech Stack:** Next.js 15.5 (App Router), React 19, next-auth 5.0.0-beta.31, mysql2, bcryptjs, jose 6, nodemailer, lucide-react, plain CSS (no animation library), node:test.

**Spec:** `docs/superpowers/specs/2026-10-23-public-pages-auth-revamp-design.md`. Read it before starting any task. The approved mockups are in `.superpowers/brainstorm/1978-1792735932/content/` (`landing-f1-v6.html`, `auth-login-v4.html`, `auth-signup-reset-v5.html`).

## Global Constraints

- Sign-up collects **only** first name, last name, email and password. Never collect date of birth, middle name, program, specialization or status (spec D1).
- Google identity is **never** read from the URL or the request body. It comes from Google's verified sign-in (OAuth profile or a verified ID token) or from the encrypted ticket cookie `vb_signup_ticket` (salt `vb-signup-ticket`, `maxAge` 900 s).
- Password rules: minimum **8** characters, maximum **72 UTF-8 bytes** (the bcrypt limit), bcrypt cost **12**.
- Reset tokens: 32 random bytes in base64url. **Only the SHA-256 hex hash is stored.** Reset links expire after **30 min**, verification links after **24 h** (1440 min). Resend cooldown is **60 s** per user and purpose.
- Login lock: **5** failed attempts lock the account for **600 s** (existing behaviour, kept).
- `session_version` is re-checked at most every **5 min** (`AUTH_SV_RECHECK_MS`, default 300000).
- Dayparts by local hour: morning **5–11**, afternoon **12–16**, evening **17–20**, night **21–4**.
- Copy is exact, as written in the tasks. The landing page must pass the honesty table in spec §5.3: no trend arrows, no "On track" at GWA level, no user counts, ratings or testimonials. Every product card shows a "Sample data" tag.
- Input text is **16px** (prevents iOS zoom). Tap targets are **≥ 44px**. Easing is `cubic-bezier(.23,1,.32,1)`. Only `transform` and `opacity` are animated. Everything respects `prefers-reduced-motion`.
- No GSAP or animation library. No Tailwind classes in the new public pages (use `public.css`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Run `git status --short` before every commit: this repo sometimes has unrelated staged files, so stage only the files the task lists.
- Local DB: XAMPP MariaDB, database `vibeboard`, CLI at `/c/xampp/mysql/bin/mysql.exe -u root vibeboard`.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `scripts/auth-test.mjs` | create | Transpile and run the auth and email pure-lib tests |
| `src/lib/auth/daypart.ts` | create | Daypart from hour, copy, pre-paint script source, "Thursday · 2:40 PM" |
| `src/lib/auth/validate.ts` | create | Name, email and password validation; year-level mapping |
| `src/lib/auth/tokens.ts` | create | Token generation and hashing; TTL constants |
| `src/lib/auth/lockout.ts` | create | Seconds left on a login lock |
| `src/lib/auth/emailTypo.ts` | create | "Did you mean gmail.com?" |
| `src/lib/auth/passwordStrength.ts` | create | Score 0–4 plus label and hint |
| `src/lib/auth/__tests__/*.test.ts` | create | Unit tests |
| `src/lib/email/templates.ts` | create | Reset, Google-account and verify emails (HTML-escaped) |
| `src/lib/email/mailer.ts` | create | nodemailer Gmail transport with a dev console fallback |
| `src/lib/migrate.ts` | modify | `ensureAuthV2Schema()` |
| `database/migrations/auth/schema-auth-v2.sql` | create | Documented migration |
| `database/schema.sql` | modify | `user_login` plus the `auth_tokens` DDL |
| `src/lib/auth/users.ts` | create | `user_login` access |
| `src/lib/auth/authTokens.ts` | create | `auth_tokens` issue, peek, reset and verify |
| `src/lib/auth/ticket.ts` | create | Seal and open the sign-up ticket; cookie helpers |
| `src/lib/auth/googleIdToken.ts` | create | Verify a GIS ID token with jose |
| `src/lib/auth/resolveGoogle.ts` | create | Google identity → existing user, link, or new-user ticket |
| `src/auth.ts` | rewrite | Five providers; `jwt` with `session_version` |
| `src/auth.config.ts` | modify | `PROTECTED` and `AUTH_PAGES` |
| `src/types/next-auth.d.ts` | modify | JWT `sv` and `svAt` |
| `src/app/api/auth/signup/route.ts` | rewrite | Email sign-up |
| `src/app/api/auth/signup-ticket/route.ts` | create | GET sets the ticket cookie and redirects; DELETE clears it |
| `src/app/api/auth/google-onetap/route.ts` | create | Verify a GIS credential → existing or new (sets the ticket) |
| `src/app/api/auth/password/forgot/route.ts` | create | Always 200; sends a reset or Google-account email |
| `src/app/api/auth/verify/resend/route.ts` | create | Resend verification (signed in) |
| `src/app/layout.tsx` | modify | `suppressHydrationWarning` on `<html>` |
| `src/app/(public)/layout.tsx` | create | `public.css` plus the daypart script |
| `src/app/(public)/public.css` | create | Tokens, auth shell, fields, landing, motion |
| `src/components/public/auth/*` | create | `AuthShell`, `Field`, `PasswordField`, `GoogleButton`, `GooglePersonalized`, `YearPicker`, `DaypartGreeting`, forms |
| `src/app/(public)/login/page.tsx` | create | Login (old `src/app/login/page.tsx` deleted) |
| `src/app/(public)/signup/page.tsx`, `signup/finish/page.tsx` | create | Sign-up and finish (old `src/app/signup/page.tsx` deleted) |
| `src/app/(public)/forgot-password`, `reset-password`, `verify-email` | create | Reset and verify pages |
| `src/components/public/landing/*` | create | Landing sections |
| `src/app/(public)/page.tsx` | create | Landing (old `src/app/page.tsx` deleted) |
| `src/app/(public)/privacy/page.tsx`, `terms/page.tsx` | create | Draft legal pages |
| `src/components/dashboard/VerifyEmailBanner.tsx` | create | Unverified-email banner |
| `src/app/dashboard/page.tsx` | modify | Mount the banner |
| `src/app/studypulse/subjects/page.tsx`, `src/components/studypulse/SubjectsGrid.tsx` | modify | Year prefill |
| `.env.example`, `README.md`, `package.json` | modify | New env vars, setup docs, deps, `auth-test` script |

---

### Task 1: Pure auth libs (daypart, validate, tokens, lockout) and the test runner

**Files:**
- Create: `scripts/auth-test.mjs`, `src/lib/auth/daypart.ts`, `src/lib/auth/validate.ts`, `src/lib/auth/tokens.ts`, `src/lib/auth/lockout.ts`
- Test: `src/lib/auth/__tests__/daypart.test.ts`, `validate.test.ts`, `tokens.test.ts`, `lockout.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces:
  - `daypart.ts`:
    - `type Daypart = 'morning'|'afternoon'|'evening'|'night'`
    - `daypartFor(hour: number): Daypart`
    - `isDaypart(v: unknown): v is Daypart`
    - `DAYPART_COPY: Record<Daypart, { greeting: string; login: string; signup: string }>`
    - `daypartScript(allowOverride: boolean): string`
    - `formatWhen(d: Date): string`
  - `validate.ts`:
    - `cleanName(v: unknown): string`
    - `nameError(v: string, label: string): string | null`
    - `cleanEmail(v: unknown): string`
    - `emailError(v: string): string | null`
    - `passwordError(v: string): string | null`
    - `MIN_PASSWORD = 8`
    - `YEAR_OPTIONS = ['1st','2nd','3rd','4th','5th+'] as const`
    - `type YearOption`
    - `yearLevelFor(v: unknown): string | null`
  - `tokens.ts`:
    - `newToken(): string`
    - `hashToken(t: string): string`
    - `RESET_TTL_MIN = 30`, `VERIFY_TTL_MIN = 1440`, `RESEND_COOLDOWN_SEC = 60`
  - `lockout.ts`:
    - `MAX_ATTEMPTS = 5`, `LOCK_SECONDS = 600`
    - `lockSecondsLeft(failed: number, sinceLastAttemptSec: number | null): number`

- [ ] **Step 1: Create the test runner**

`scripts/auth-test.mjs` (same approach as `scripts/sp-test.mjs`):

```js
#!/usr/bin/env node
// Auth + email pure-lib tests. Same approach as scripts/sp-test.mjs: transpile pool-free modules with the
// project's TypeScript into a temp dir and run node:test on *.test.ts.
// Usage: node scripts/auth-test.mjs [substring-filter]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const ROOT = 'src/lib';
// Only pure modules (no DB pool, no next/*, no node_modules imports) plus their tests.
const INCLUDE = /^(auth\/(__tests__\/[\w-]+\.test|daypart|validate|tokens|lockout|emailTypo|passwordStrength)|email\/templates)\.ts$/;
const out = mkdtempSync(join(tmpdir(), 'auth-test-'));
const walk = d => readdirSync(d).flatMap(n => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.ts') ? [p] : []);
});

const tests = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (!INCLUDE.test(rel)) continue;
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const fromDir = posix.dirname(rel);
  const js = outputText
    .replace(/(from\s+['"])@\/lib\/([^'"]+)(['"])/g, (_, a, p, b) => {
      let r = posix.relative(fromDir, p);
      if (!r.startsWith('.')) r = './' + r;
      return `${a}${r}${b}`;
    })
    .replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, '$1$2.mjs$3');
  const dest = join(out, rel).replace(/\.ts$/, '.mjs');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, js);
  if (file.endsWith('.test.ts')) tests.push(dest);
}

const filter = process.argv[2];
const selected = filter ? tests.filter(t => t.includes(filter)) : tests;
if (selected.length === 0) { console.error('no auth tests matched'); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...selected], { stdio: 'inherit' });
process.exit(r.status ?? 1);
```

In `package.json` `"scripts"`, add `"test:auth": "node scripts/auth-test.mjs"` after `"lint"`.

- [ ] **Step 2: Write the failing tests**

`src/lib/auth/__tests__/daypart.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daypartFor, isDaypart, daypartScript, formatWhen, DAYPART_COPY } from '../daypart';

test('daypartFor boundaries', () => {
  assert.equal(daypartFor(4), 'night');
  assert.equal(daypartFor(5), 'morning');
  assert.equal(daypartFor(11), 'morning');
  assert.equal(daypartFor(12), 'afternoon');
  assert.equal(daypartFor(16), 'afternoon');
  assert.equal(daypartFor(17), 'evening');
  assert.equal(daypartFor(20), 'evening');
  assert.equal(daypartFor(21), 'night');
  assert.equal(daypartFor(0), 'night');
});

test('isDaypart', () => {
  assert.equal(isDaypart('night'), true);
  assert.equal(isDaypart('noon'), false);
  assert.equal(isDaypart(undefined), false);
});

function runScript(hour: number, search: string, allowOverride: boolean) {
  const doc = { documentElement: { dataset: {} as Record<string, string> } };
  class FakeDate { getHours() { return hour; } }
  new Function('document', 'location', 'Date', daypartScript(allowOverride))(doc, { search }, FakeDate);
  return doc.documentElement.dataset.daypart;
}

test('daypartScript matches daypartFor for every hour', () => {
  for (let h = 0; h < 24; h++) assert.equal(runScript(h, '', false), daypartFor(h), `hour ${h}`);
});

test('daypartScript honours ?daypart= only when allowed', () => {
  assert.equal(runScript(14, '?daypart=night', true), 'night');
  assert.equal(runScript(14, '?daypart=night', false), 'afternoon');
  assert.equal(runScript(14, '?daypart=bogus', true), 'afternoon');
});

test('formatWhen', () => {
  assert.equal(formatWhen(new Date(2026, 9, 23, 14, 40)), 'Friday · 2:40 PM');
});

test('copy is exact', () => {
  assert.equal(DAYPART_COPY.night.greeting, 'Still up?');
  assert.equal(DAYPART_COPY.night.login, "Your board's ready. Don't stay too late.");
  assert.equal(DAYPART_COPY.morning.login, "Let's set up the day.");
  assert.equal(DAYPART_COPY.afternoon.login, 'Pick up where you left off.');
  assert.equal(DAYPART_COPY.evening.login, 'Time to wrap up the day.');
});
```

(2026-10-23 is a Friday. `new Date(2026, 9, 23, …)` uses local time, so `formatWhen` reads local time.)

`src/lib/auth/__tests__/validate.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, nameError, cleanEmail, emailError, passwordError, yearLevelFor } from '../validate';

test('cleanName trims and collapses spaces; non-strings become empty', () => {
  assert.equal(cleanName('  Juan   Dela  Cruz '), 'Juan Dela Cruz');
  assert.equal(cleanName(42), '');
});

test('nameError', () => {
  assert.equal(nameError('', 'first name'), 'Enter your first name.');
  assert.equal(nameError('María', 'first name'), null);
  assert.equal(nameError('李', 'first name'), null);
  assert.equal(nameError("O'Neil-Santos Jr.", 'last name'), null);
  assert.equal(nameError('x'.repeat(101), 'last name'), 'Last name is too long.');
  assert.equal(nameError('Juan😀', 'first name'), 'First name can only use letters, spaces, apostrophes, periods and hyphens.');
  assert.equal(nameError('<b>', 'first name'), 'First name can only use letters, spaces, apostrophes, periods and hyphens.');
});

test('email', () => {
  assert.equal(cleanEmail('  Juan@School.EDU.ph '), 'juan@school.edu.ph');
  assert.equal(emailError(''), 'Enter your email.');
  assert.equal(emailError('juan@school'), 'Enter a valid email, like you@school.edu.ph.');
  assert.equal(emailError('juan@school.edu.ph'), null);
  assert.equal(emailError(`${'a'.repeat(95)}@x.com`), 'That email is too long.');
});

test('passwordError', () => {
  assert.equal(passwordError(''), 'Enter a password.');
  assert.equal(passwordError('1234567'), 'Use at least 8 characters.');
  assert.equal(passwordError('12345678'), null);
  assert.equal(passwordError('é'.repeat(37)), 'Use 72 bytes or fewer (about 72 letters).');
});

test('yearLevelFor', () => {
  assert.equal(yearLevelFor('2nd'), '2nd Year');
  assert.equal(yearLevelFor('5th+'), '5th Year');
  assert.equal(yearLevelFor(''), null);
  assert.equal(yearLevelFor('6th'), null);
  assert.equal(yearLevelFor(undefined), null);
});
```

`src/lib/auth/__tests__/tokens.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newToken, hashToken, RESET_TTL_MIN, VERIFY_TTL_MIN, RESEND_COOLDOWN_SEC } from '../tokens';

test('newToken is 43-char base64url and unique', () => {
  const a = newToken(), b = newToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test('hashToken is stable sha256 hex', () => {
  assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.match(hashToken(newToken()), /^[0-9a-f]{64}$/);
});

test('constants', () => {
  assert.equal(RESET_TTL_MIN, 30);
  assert.equal(VERIFY_TTL_MIN, 1440);
  assert.equal(RESEND_COOLDOWN_SEC, 60);
});
```

`src/lib/auth/__tests__/lockout.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockSecondsLeft } from '../lockout';

test('lockSecondsLeft', () => {
  assert.equal(lockSecondsLeft(4, 10), 0);
  assert.equal(lockSecondsLeft(5, null), 0);
  assert.equal(lockSecondsLeft(5, 0), 600);
  assert.equal(lockSecondsLeft(5, 60), 540);
  assert.equal(lockSecondsLeft(9, 599), 1);
  assert.equal(lockSecondsLeft(5, 600), 0);
  assert.equal(lockSecondsLeft(5, -3), 600); // clock skew never extends past the full window
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `node scripts/auth-test.mjs`
Expected: FAIL. `ERR_MODULE_NOT_FOUND` for `daypart.mjs` and the other modules.

- [ ] **Step 4: Implement the modules**

`src/lib/auth/daypart.ts`:

```ts
/* Time-of-day "daypart" for the public auth pages (spec §6.1). Pure: no DOM access except inside the
   script string, which runs inline before first paint. */
export type Daypart = 'morning' | 'afternoon' | 'evening' | 'night';

export function daypartFor(hour: number): Daypart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export function isDaypart(v: unknown): v is Daypart {
  return v === 'morning' || v === 'afternoon' || v === 'evening' || v === 'night';
}

export const DAYPART_COPY: Record<Daypart, { greeting: string; login: string; signup: string }> = {
  morning:   { greeting: 'Good morning.',   login: "Let's set up the day.",                   signup: 'Free for students. Takes under a minute.' },
  afternoon: { greeting: 'Good afternoon.', login: 'Pick up where you left off.',             signup: 'Free for students. Takes under a minute.' },
  evening:   { greeting: 'Good evening.',   login: 'Time to wrap up the day.',                signup: 'Free for students. Takes under a minute.' },
  night:     { greeting: 'Still up?',       login: "Your board's ready. Don't stay too late.", signup: 'Free for students. Takes under a minute.' },
};

/** Source of the inline script that sets <html data-daypart> before first paint. Keep the hour rule in
 *  sync with daypartFor (a test enforces it). The ?daypart= override is for QA screenshots only. */
export function daypartScript(allowOverride: boolean): string {
  const override = allowOverride
    ? "var q=new URLSearchParams(location.search).get('daypart');if(q==='morning'||q==='afternoon'||q==='evening'||q==='night')d=q;"
    : '';
  return "(function(){try{var h=new Date().getHours();var d=h>=5&&h<12?'morning':h>=12&&h<17?'afternoon':h>=17&&h<21?'evening':'night';"
    + override + 'document.documentElement.dataset.daypart=d;}catch(e){}})();';
}

/** "Thursday · 2:40 PM" in the visitor's local time. */
export function formatWhen(d: Date): string {
  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}
```

`src/lib/auth/validate.ts`:

```ts
/* Shared client + server validation for the auth forms (spec §3.3). Messages are user-facing copy. */
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} '.\-]*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MIN_PASSWORD = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt ignores everything after 72 bytes

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
}

export function nameError(v: string, label: string): string | null {
  if (!v) return `Enter your ${label}.`;
  if (v.length > 100) return `${cap(label)} is too long.`;
  if (!NAME_RE.test(v)) return `${cap(label)} can only use letters, spaces, apostrophes, periods and hyphens.`;
  return null;
}

export function cleanEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

export function emailError(v: string): string | null {
  if (!v) return 'Enter your email.';
  if (v.length > 100) return 'That email is too long.';
  if (!EMAIL_RE.test(v)) return 'Enter a valid email, like you@school.edu.ph.';
  return null;
}

export function passwordError(v: string): string | null {
  if (!v) return 'Enter a password.';
  if (v.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (new TextEncoder().encode(v).length > MAX_PASSWORD_BYTES) return 'Use 72 bytes or fewer (about 72 letters).';
  return null;
}

export const YEAR_OPTIONS = ['1st', '2nd', '3rd', '4th', '5th+'] as const;
export type YearOption = (typeof YEAR_OPTIONS)[number];

/** Maps the finish-page picker value to the user_login.year_level enum ('5th+' → '5th Year'). */
export function yearLevelFor(v: unknown): string | null {
  switch (v) {
    case '1st': return '1st Year';
    case '2nd': return '2nd Year';
    case '3rd': return '3rd Year';
    case '4th': return '4th Year';
    case '5th+': return '5th Year';
    default: return null;
  }
}
```

`src/lib/auth/tokens.ts`:

```ts
import { randomBytes, createHash } from 'node:crypto';

export const RESET_TTL_MIN = 30;
export const VERIFY_TTL_MIN = 1440;
export const RESEND_COOLDOWN_SEC = 60;

/** 32 random bytes, base64url (43 chars). Only ever emailed; the DB stores hashToken(t). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}
```

`src/lib/auth/lockout.ts`:

```ts
export const MAX_ATTEMPTS = 5;
export const LOCK_SECONDS = 600;

/** Seconds until a locked account can try again. `sinceLastAttemptSec` comes from
 *  TIMESTAMPDIFF(SECOND, last_attempt, NOW()) so it is time-zone independent. */
export function lockSecondsLeft(failed: number, sinceLastAttemptSec: number | null): number {
  if (failed < MAX_ATTEMPTS || sinceLastAttemptSec === null) return 0;
  const since = Math.max(0, sinceLastAttemptSec);
  return since >= LOCK_SECONDS ? 0 : LOCK_SECONDS - since;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node scripts/auth-test.mjs`
Expected: PASS for every test in the four files.

- [ ] **Step 6: Commit**

```bash
git status --short
git add scripts/auth-test.mjs package.json src/lib/auth/daypart.ts src/lib/auth/validate.ts src/lib/auth/tokens.ts src/lib/auth/lockout.ts src/lib/auth/__tests__/daypart.test.ts src/lib/auth/__tests__/validate.test.ts src/lib/auth/__tests__/tokens.test.ts src/lib/auth/__tests__/lockout.test.ts
git commit -m "Add pure auth libs: daypart, validation, tokens, lockout

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Email typo hints, password strength and email templates

**Files:**
- Create: `src/lib/auth/emailTypo.ts`, `src/lib/auth/passwordStrength.ts`, `src/lib/email/templates.ts`
- Test: `src/lib/auth/__tests__/emailTypo.test.ts`, `passwordStrength.test.ts`, `templates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `emailTypo.ts`:
    - `editDistance(a: string, b: string): number`
    - `suggestEmail(email: string): string | null`
  - `passwordStrength.ts`:
    - `interface Strength { score: 0|1|2|3|4; label: string; hint: string }`
    - `scorePassword(pw: string): Strength`
  - `templates.ts`:
    - `interface MailContent { subject: string; html: string; text: string }`
    - `absoluteUrl(path: string): string`
    - `resetMail(p: { firstName: string; url: string; minutes: number }): MailContent`
    - `googleAccountMail(p: { firstName: string; url: string; minutes: number }): MailContent`
    - `verifyMail(p: { firstName: string; url: string }): MailContent`

- [ ] **Step 1: Write the failing tests**

`src/lib/auth/__tests__/emailTypo.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, suggestEmail } from '../emailTypo';

test('editDistance', () => {
  assert.equal(editDistance('gmail.com', 'gmail.com'), 0);
  assert.equal(editDistance('gmial.com', 'gmail.com'), 2);
  assert.equal(editDistance('gmail.co', 'gmail.com'), 1);
});

test('suggestEmail fixes near-miss domains, keeps the local part', () => {
  assert.equal(suggestEmail('juan@gmial.com'), 'juan@gmail.com');
  assert.equal(suggestEmail('Juan.DC@gmail.co'), 'Juan.DC@gmail.com');
  assert.equal(suggestEmail('juan@yaho.com'), 'juan@yahoo.com');
  assert.equal(suggestEmail('kd@fit.edu.pj'), 'kd@fit.edu.ph');
});

test('suggestEmail stays quiet when correct, unknown or malformed', () => {
  assert.equal(suggestEmail('juan@gmail.com'), null);
  assert.equal(suggestEmail('juan@mail.com'), null);
  assert.equal(suggestEmail('juan@feutech.edu.ph'), null);
  assert.equal(suggestEmail('juan'), null);
  assert.equal(suggestEmail('@gmail.com'), null);
});
```

`src/lib/auth/__tests__/passwordStrength.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePassword } from '../passwordStrength';

test('scorePassword', () => {
  assert.deepEqual(scorePassword(''), { score: 0, label: '', hint: 'At least 8 characters.' });
  assert.deepEqual(scorePassword('abc'), { score: 0, label: 'Too short', hint: '5 more characters.' });
  assert.deepEqual(scorePassword('abcdefg'), { score: 0, label: 'Too short', hint: '1 more character.' });
  assert.equal(scorePassword('password').label, 'Too common');
  assert.equal(scorePassword('Password1').score, 1);           // common list is case-insensitive
  assert.equal(scorePassword('aaaaaaaaaa').label, 'Too common'); // one repeated character
  assert.deepEqual(scorePassword('abcdefgh'), { score: 1, label: 'Weak', hint: 'Make it longer or mix in numbers and symbols.' });
  assert.deepEqual(scorePassword('abcdefghijkl'), { score: 2, label: 'Fair', hint: 'Longer is stronger. Try 12+ characters with a number.' });
  assert.deepEqual(scorePassword('Juandelacruz7'), { score: 3, label: 'Strong enough', hint: 'Add a symbol to make it great.' });
  assert.deepEqual(scorePassword('Juan dela Cruz 2026!'), { score: 4, label: 'Great password', hint: '' });
});
```

`src/lib/auth/__tests__/templates.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetMail, googleAccountMail, verifyMail, absoluteUrl } from '../../email/templates';

test('absoluteUrl uses AUTH_URL without a trailing slash', () => {
  process.env.AUTH_URL = 'http://localhost:3000/';
  assert.equal(absoluteUrl('/reset-password?token=x'), 'http://localhost:3000/reset-password?token=x');
});

test('resetMail', () => {
  const m = resetMail({ firstName: 'Juan', url: 'http://localhost:3000/reset-password?token=abc', minutes: 30 });
  assert.equal(m.subject, 'Reset your VibeBoard password');
  assert.match(m.text, /http:\/\/localhost:3000\/reset-password\?token=abc/);
  assert.match(m.text, /30 minutes/);
  assert.match(m.html, /href="http:\/\/localhost:3000\/reset-password\?token=abc"/);
});

test('names are HTML-escaped', () => {
  const m = verifyMail({ firstName: '<img src=x onerror=alert(1)>', url: 'http://x/verify-email?token=1' });
  assert.equal(m.subject, 'Confirm your email for VibeBoard');
  assert.doesNotMatch(m.html, /<img src=x/);
  assert.match(m.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('googleAccountMail', () => {
  const m = googleAccountMail({ firstName: 'Ana', url: 'http://x/reset-password?token=2', minutes: 30 });
  assert.equal(m.subject, 'How to sign in to VibeBoard');
  assert.match(m.text, /Continue with Google/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node scripts/auth-test.mjs`
Expected: FAIL. `ERR_MODULE_NOT_FOUND` for `emailTypo.mjs`, `passwordStrength.mjs` and `templates.mjs`.

- [ ] **Step 3: Implement**

`src/lib/auth/emailTypo.ts`:

```ts
/* "Did you mean …?" for common email-domain typos (spec §7.1). Suggests only within edit distance 2 of a
   known domain, and never when the typed domain is itself known. */
const DOMAINS = [
  'gmail.com', 'yahoo.com', 'yahoo.com.ph', 'outlook.com', 'hotmail.com',
  'icloud.com', 'live.com', 'mail.com', 'ymail.com', 'fit.edu.ph',
];

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

export function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain || DOMAINS.includes(domain)) return null;
  let best: string | null = null;
  let bestDist = 3;
  for (const d of DOMAINS) {
    const dist = editDistance(domain, d);
    if (dist > 0 && dist < bestDist) { best = d; bestDist = dist; }
  }
  return best ? `${local}@${best}` : null;
}
```

`src/lib/auth/passwordStrength.ts`:

```ts
/* Lightweight strength meter (spec §7.2). Not a security boundary; the server enforces only the 8-char minimum. */
import { MIN_PASSWORD } from './validate';

export interface Strength { score: 0 | 1 | 2 | 3 | 4; label: string; hint: string }

const COMMON = new Set([
  'password', 'password1', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop', 'iloveyou',
  'abc12345', '11111111', '00000000', 'admin123', 'letmein1', 'welcome1', 'sunshine', 'princess',
  'football', 'baseball', 'dragon12', 'monkey12', 'vibeboard', 'vibeboard1',
]);

export function scorePassword(pw: string): Strength {
  if (!pw) return { score: 0, label: '', hint: `At least ${MIN_PASSWORD} characters.` };
  if (pw.length < MIN_PASSWORD) {
    const n = MIN_PASSWORD - pw.length;
    return { score: 0, label: 'Too short', hint: `${n} more character${n === 1 ? '' : 's'}.` };
  }
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) {
    return { score: 1, label: 'Too common', hint: "This one is easy to guess. Try a phrase only you'd know." };
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  let score = 1;
  if (pw.length >= 12) score++;
  if (classes >= 3) score++;
  if (pw.length >= 16 || (classes === 4 && pw.length >= 10)) score++;
  const s = Math.min(score, 4) as Strength['score'];
  if (s === 1) return { score: 1, label: 'Weak', hint: 'Make it longer or mix in numbers and symbols.' };
  if (s === 2) return { score: 2, label: 'Fair', hint: 'Longer is stronger. Try 12+ characters with a number.' };
  if (s === 3) {
    const hint = /[^A-Za-z0-9]/.test(pw) ? 'A few more characters make it great.' : 'Add a symbol to make it great.';
    return { score: 3, label: 'Strong enough', hint };
  }
  return { score: 4, label: 'Great password', hint: '' };
}
```

`src/lib/email/templates.ts`:

```ts
/* Transactional email bodies (spec §3.4). Pure: string in, string out. Every interpolated user value is
   HTML-escaped; URLs are built server-side from AUTH_URL plus a random token. */
export interface MailContent { subject: string; html: string; text: string }

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function absoluteUrl(path: string): string {
  const base = (process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}${path}`;
}

function layout(heading: string, bodyHtml: string, cta: { label: string; url: string }, footnote: string): string {
  return `<!doctype html><html><body style="margin:0;background:#fbf8fb;font-family:'DM Sans',Arial,sans-serif;color:#1f1b2b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;border:1px solid #ece8f0">
<tr><td style="padding:28px 28px 8px;font-size:18px;font-weight:800"><span style="color:#d9628c">Vibe</span><span style="color:#3d8fbf">Board</span></td></tr>
<tr><td style="padding:8px 28px 0;font-size:22px;font-weight:700;letter-spacing:-0.02em">${esc(heading)}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:15px;line-height:1.55;color:#4a4458">${bodyHtml}</td></tr>
<tr><td style="padding:22px 28px 6px"><a href="${esc(cta.url)}" style="display:inline-block;background:#1f1b2b;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:12px">${esc(cta.label)}</a></td></tr>
<tr><td style="padding:14px 28px 28px;font-size:12.5px;line-height:1.5;color:#6b6478">${footnote}<br>If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all;color:#3d8fbf">${esc(cta.url)}</span></td></tr>
</table></td></tr></table></body></html>`;
}

export function resetMail(p: { firstName: string; url: string; minutes: number }): MailContent {
  const subject = 'Reset your VibeBoard password';
  const text = `Hi ${p.firstName},\n\nSomeone (hopefully you) asked to reset your VibeBoard password.\n\nSet a new one here: ${p.url}\n\nThis link works once and expires in ${p.minutes} minutes. If you didn't ask for this, you can ignore this email. Your password won't change.\n\nVibeBoard`;
  const html = layout(
    'Reset your password',
    `Hi ${esc(p.firstName)}, someone (hopefully you) asked to reset your VibeBoard password.`,
    { label: 'Set a new password', url: p.url },
    `This link works once and expires in ${p.minutes} minutes. If you didn't ask for this, ignore this email. Your password won't change.`,
  );
  return { subject, html, text };
}

export function googleAccountMail(p: { firstName: string; url: string; minutes: number }): MailContent {
  const subject = 'How to sign in to VibeBoard';
  const text = `Hi ${p.firstName},\n\nYour VibeBoard account signs in with Google. On the login page, choose "Continue with Google".\n\nWant to be able to log in with a password too? Set one here: ${p.url}\n\nThis link works once and expires in ${p.minutes} minutes.\n\nVibeBoard`;
  const html = layout(
    'You sign in with Google',
    `Hi ${esc(p.firstName)}, your VibeBoard account signs in with Google. On the login page, choose <b>Continue with Google</b>.<br><br>Want a password too? You can set one below.`,
    { label: 'Set a password', url: p.url },
    `This link works once and expires in ${p.minutes} minutes.`,
  );
  return { subject, html, text };
}

export function verifyMail(p: { firstName: string; url: string }): MailContent {
  const subject = 'Confirm your email for VibeBoard';
  const text = `Hi ${p.firstName},\n\nConfirm your email so you can always reset your password: ${p.url}\n\nThis link expires in 24 hours.\n\nVibeBoard`;
  const html = layout(
    'Confirm your email',
    `Hi ${esc(p.firstName)}, welcome to VibeBoard! Confirm your email so you can always reset your password.`,
    { label: 'Confirm my email', url: p.url },
    'This link expires in 24 hours.',
  );
  return { subject, html, text };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node scripts/auth-test.mjs`
Expected: PASS for all seven test files.

- [ ] **Step 5: Commit**

```bash
git status --short
git add src/lib/auth/emailTypo.ts src/lib/auth/passwordStrength.ts src/lib/email/templates.ts src/lib/auth/__tests__/emailTypo.test.ts src/lib/auth/__tests__/passwordStrength.test.ts src/lib/auth/__tests__/templates.test.ts
git commit -m "Add email typo hints, password strength and email templates

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Schema migration (`ensureAuthV2Schema`)

**Files:**
- Modify: `src/lib/migrate.ts` (add a flag near the other `_ran*` flags, and a function at the end of the file)
- Create: `database/migrations/auth/schema-auth-v2.sql`
- Modify: `database/schema.sql` (the `user_login` block at ~line 886, plus a new `auth_tokens` block)

**Interfaces:**
- Produces: `ensureAuthV2Schema(): Promise<void>` (idempotent, cached per process).

- [ ] **Step 1: Back up the users table**

Run:
```bash
mkdir -p "C:/Users/LENOVO/AppData/Local/Temp/claude/c--xampp-htdocs-VibeBoard/230f11cd-a627-4240-af1a-16b7665e215e/scratchpad"
/c/xampp/mysql/bin/mysqldump.exe -u root vibeboard user_login > "C:/Users/LENOVO/AppData/Local/Temp/claude/c--xampp-htdocs-VibeBoard/230f11cd-a627-4240-af1a-16b7665e215e/scratchpad/user_login-before-auth-v2.sql"
```
Expected: the file exists and contains `INSERT INTO \`user_login\``.

- [ ] **Step 2: Add the migration function**

In `src/lib/migrate.ts`, add `let _ranAuthV2 = false;` after `let _ranProjectionPrefs = false;`, then append:

```ts
/** Auth v2 (public pages + auth revamp spec §3.5): optional legacy profile columns, Google subject,
 *  email verification, session revocation, created_at, and the auth_tokens table. Idempotent. */
export async function ensureAuthV2Schema(): Promise<void> {
  if (_ranAuthV2) return;
  // MODIFY is safe to repeat: it only relaxes NOT NULL and widens the year enum.
  await pool.query(`ALTER TABLE user_login
      MODIFY middle_name VARCHAR(100) NULL,
      MODIFY year_level  ENUM('1st Year','2nd Year','3rd Year','4th Year','5th Year') NULL,
      MODIFY status      ENUM('Regular','Irregular') NULL,
      MODIFY program     INT(11) NULL,
      MODIFY password    VARCHAR(255) NULL`);
  const add = async (sql: string): Promise<boolean> => {
    try { await pool.query(sql); return true; } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'ER_DUP_FIELDNAME' || code === 'ER_DUP_KEYNAME') return false;
      throw err;
    }
  };
  await add(`ALTER TABLE user_login ADD COLUMN google_sub VARCHAR(255) NULL`);
  if (await add(`ALTER TABLE user_login ADD COLUMN email_verified_at DATETIME NULL`)) {
    // Accounts created before verification existed are treated as verified, so linking Google
    // never wipes their passwords (spec §3.5). Runs only in the call that adds the column.
    await pool.query(`UPDATE user_login SET email_verified_at = NOW() WHERE email_verified_at IS NULL`);
  }
  await add(`ALTER TABLE user_login ADD COLUMN session_version INT NOT NULL DEFAULT 0`);
  await add(`ALTER TABLE user_login ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await add(`ALTER TABLE user_login ADD UNIQUE KEY google_sub_unique (google_sub)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS auth_tokens (
      token_id   INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      purpose    ENUM('reset','verify') NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at    DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY token_hash_unique (token_hash),
      KEY user_purpose (user_id, purpose, created_at),
      CONSTRAINT auth_tokens_user FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  _ranAuthV2 = true;
}
```

- [ ] **Step 3: Write the documented SQL file**

`database/migrations/auth/schema-auth-v2.sql`:

```sql
-- Auth v2 (docs/superpowers/specs/2026-10-23-public-pages-auth-revamp-design.md §3.5).
-- The app applies the same change idempotently via ensureAuthV2Schema() in src/lib/migrate.ts.
-- Run this file once by hand only on a database the app has not touched yet.
ALTER TABLE user_login
  MODIFY middle_name VARCHAR(100) NULL,
  MODIFY year_level  ENUM('1st Year','2nd Year','3rd Year','4th Year','5th Year') NULL,
  MODIFY status      ENUM('Regular','Irregular') NULL,
  MODIFY program     INT(11) NULL,
  MODIFY password    VARCHAR(255) NULL,
  ADD COLUMN google_sub        VARCHAR(255) NULL,
  ADD COLUMN email_verified_at DATETIME NULL,
  ADD COLUMN session_version   INT NOT NULL DEFAULT 0,
  ADD COLUMN created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD UNIQUE KEY google_sub_unique (google_sub);

-- Existing accounts predate verification; treat them as verified (accepted risk, spec §3.5).
UPDATE user_login SET email_verified_at = NOW() WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_id   INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  purpose    ENUM('reset','verify') NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at    DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY token_hash_unique (token_hash),
  KEY user_purpose (user_id, purpose, created_at),
  CONSTRAINT auth_tokens_user FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```

- [ ] **Step 4: Update `database/schema.sql`**

Replace lines `889`–`901` of the `user_login` block (from `` `middle_name` `` through `` `last_attempt` ``) with:

```sql
  `middle_name` varchar(100) DEFAULT NULL,
  `surname` varchar(100) NOT NULL,
  `dateofbirth` date DEFAULT NULL,
  `email` varchar(100) NOT NULL,
  `year_level` enum('1st Year','2nd Year','3rd Year','4th Year','5th Year') DEFAULT NULL,
  `status` enum('Regular','Irregular') DEFAULT NULL,
  `program` int(11) DEFAULT NULL,
  `specialization` int(11) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `reset_token` varchar(255) DEFAULT NULL,
  `reset_token_expiry` datetime DEFAULT NULL,
  `failed_attempts` int(11) NOT NULL DEFAULT 0,
  `last_attempt` datetime DEFAULT NULL,
  `google_sub` varchar(255) DEFAULT NULL,
  `email_verified_at` datetime DEFAULT NULL,
  `session_version` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
```

Then add `  UNIQUE KEY \`google_sub_unique\` (\`google_sub\`),` after the `email_unique` line. Directly after the `user_login` `CREATE TABLE` statement ends (`) ENGINE=InnoDB …;`), add the `auth_tokens` `CREATE TABLE IF NOT EXISTS` statement exactly as in Step 3.

- [ ] **Step 5: Apply to the local DB and verify**

Run:
```bash
/c/xampp/mysql/bin/mysql.exe -u root vibeboard < database/migrations/auth/schema-auth-v2.sql
/c/xampp/mysql/bin/mysql.exe -u root vibeboard -e "SHOW COLUMNS FROM user_login WHERE Field IN ('middle_name','year_level','password','google_sub','email_verified_at','session_version','created_at'); SELECT COUNT(*) total, SUM(email_verified_at IS NOT NULL) verified FROM user_login; SHOW CREATE TABLE auth_tokens\G" 
```
Expected:
- `middle_name`, `year_level` and `password` show `Null: YES`. `year_level` includes `'5th Year'`.
- The four new columns exist.
- `verified` equals `total` (6 and 6).
- `auth_tokens` exists with its foreign key.

Then run `npx tsc --noEmit`. Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git status --short
git add src/lib/migrate.ts database/migrations/auth/schema-auth-v2.sql database/schema.sql
git commit -m "Add auth v2 schema: optional profile fields, google_sub, verification, session_version, auth_tokens

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Server data modules (users, authTokens, mailer)

**Files:**
- Create: `src/lib/auth/users.ts`, `src/lib/auth/authTokens.ts`, `src/lib/email/mailer.ts`
- Modify: `package.json` (deps), `.env.example`

**Interfaces:**
- Consumes:
  - `ensureAuthV2Schema()` (Task 3)
  - `newToken`, `hashToken` and `RESEND_COOLDOWN_SEC` (Task 1)
  - `MailContent` (Task 2)
- Produces:
  - `users.ts`:
    - `interface AuthUser { user_id: number; first_name: string; surname: string; email: string; password: string | null; google_sub: string | null; email_verified_at: string | null; session_version: number; failed_attempts: number; since_last_attempt: number | null; year_level: string | null }`
    - `findByEmail(email: string): Promise<AuthUser | null>`
    - `findByGoogleSub(sub: string): Promise<AuthUser | null>`
    - `findById(id: number): Promise<AuthUser | null>`
    - `createUser(u: NewUser): Promise<number>`
    - `linkGoogle(u: AuthUser, sub: string): Promise<void>`
    - `recordFailedLogin(id: number): Promise<void>`
    - `clearFailedLogins(id: number): Promise<void>`
    - `getSessionVersion(id: number): Promise<number | null>`
    - `interface NewUser { first_name: string; surname: string; email: string; password_hash: string | null; google_sub: string | null; email_verified: boolean; year_level: string | null }`
  - `authTokens.ts`:
    - `type TokenPurpose = 'reset' | 'verify'`
    - `issueToken(userId: number, purpose: TokenPurpose, ttlMinutes: number): Promise<string | null>` (`null` while the cooldown is active)
    - `peekToken(token: string, purpose: TokenPurpose): Promise<{ user_id: number; email: string; first_name: string } | null>`
    - `resetPassword(token: string, passwordHash: string): Promise<number | null>`
    - `consumeVerifyToken(token: string): Promise<number | null>`
  - `mailer.ts`:
    - `sendMail(m: MailContent & { to: string }): Promise<boolean>`

- [ ] **Step 1: Install dependencies**

Run: `npm install nodemailer@6.9.16 jose@6.2.3 && npm install -D @types/nodemailer@6.4.17`
Expected: `package.json` lists `nodemailer`, `jose` (pinned to the version already in the tree) and `@types/nodemailer`.

- [ ] **Step 2: Write `users.ts`**

```ts
/* user_login access for auth (spec §3.4). Server-only. Every call ensures the auth v2 schema first. */
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '@/lib/db';
import { ensureAuthV2Schema } from '@/lib/migrate';

export interface AuthUser {
  user_id: number;
  first_name: string;
  surname: string;
  email: string;
  password: string | null;
  google_sub: string | null;
  email_verified_at: string | null;
  session_version: number;
  failed_attempts: number;
  /** Seconds since last_attempt, computed by the DB (time-zone independent); null when never failed. */
  since_last_attempt: number | null;
  year_level: string | null;
}
interface Row extends RowDataPacket, AuthUser {}

export interface NewUser {
  first_name: string;
  surname: string;
  email: string;
  password_hash: string | null;
  google_sub: string | null;
  email_verified: boolean;
  year_level: string | null;
}

const COLS = `user_id, first_name, surname, email, password, google_sub, email_verified_at, session_version,
  failed_attempts, TIMESTAMPDIFF(SECOND, last_attempt, NOW()) AS since_last_attempt, year_level`;

async function one(where: string, params: (string | number)[]): Promise<AuthUser | null> {
  await ensureAuthV2Schema();
  const [rows] = await pool.execute<Row[]>(`SELECT ${COLS} FROM user_login WHERE ${where} LIMIT 1`, params);
  return rows[0] ?? null;
}

export const findByEmail = (email: string) => one('email = ?', [email.trim().toLowerCase()]);
export const findByGoogleSub = (sub: string) => one('google_sub = ?', [sub]);
export const findById = (id: number) => one('user_id = ?', [id]);

export async function createUser(u: NewUser): Promise<number> {
  await ensureAuthV2Schema();
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO user_login (first_name, surname, email, password, google_sub, email_verified_at, year_level)
     VALUES (?, ?, ?, ?, ?, ${u.email_verified ? 'NOW()' : 'NULL'}, ?)`,
    [u.first_name, u.surname, u.email.trim().toLowerCase(), u.password_hash, u.google_sub, u.year_level],
  );
  return r.insertId;
}

/** Link a Google identity to an existing account. A password set on an account whose owner never proved
 *  the email is untrusted: clear it and sign out other sessions (spec D11, fixes pre-hijack). */
export async function linkGoogle(u: AuthUser, sub: string): Promise<void> {
  const untrusted = u.password !== null && u.email_verified_at === null;
  await pool.execute(
    `UPDATE user_login SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, NOW())
       ${untrusted ? ', password = NULL, session_version = session_version + 1' : ''}
     WHERE user_id = ?`,
    [sub, u.user_id],
  );
}

export async function recordFailedLogin(id: number): Promise<void> {
  await pool.execute(`UPDATE user_login SET failed_attempts = failed_attempts + 1, last_attempt = NOW() WHERE user_id = ?`, [id]);
}

export async function clearFailedLogins(id: number): Promise<void> {
  await pool.execute(`UPDATE user_login SET failed_attempts = 0, last_attempt = NULL WHERE user_id = ?`, [id]);
}

export async function getSessionVersion(id: number): Promise<number | null> {
  await ensureAuthV2Schema();
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT session_version FROM user_login WHERE user_id = ?`, [id]);
  return rows[0] ? Number(rows[0].session_version) : null;
}
```

- [ ] **Step 3: Write `authTokens.ts`**

```ts
/* auth_tokens: single-use, hashed, expiring links for password reset and email verification (spec §4.6–4.7). */
import type { RowDataPacket } from 'mysql2';
import pool from '@/lib/db';
import { ensureAuthV2Schema } from '@/lib/migrate';
import { newToken, hashToken, RESEND_COOLDOWN_SEC } from '@/lib/auth/tokens';

export type TokenPurpose = 'reset' | 'verify';

/** Returns the raw token to email, or null when one was issued for this user+purpose in the cooldown window. */
export async function issueToken(userId: number, purpose: TokenPurpose, ttlMinutes: number): Promise<string | null> {
  await ensureAuthV2Schema();
  const [recent] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM auth_tokens WHERE user_id = ? AND purpose = ? AND created_at > NOW() - INTERVAL ? SECOND LIMIT 1`,
    [userId, purpose, RESEND_COOLDOWN_SEC],
  );
  if (recent.length) return null;
  const token = newToken();
  await pool.execute(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL ? MINUTE)`,
    [userId, purpose, hashToken(token), ttlMinutes],
  );
  return token;
}

/** Read-only check used to render the reset page. Does not consume the token. */
export async function peekToken(token: string, purpose: TokenPurpose): Promise<{ user_id: number; email: string; first_name: string } | null> {
  if (!token) return null;
  await ensureAuthV2Schema();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT t.user_id, u.email, u.first_name FROM auth_tokens t JOIN user_login u ON u.user_id = t.user_id
      WHERE t.token_hash = ? AND t.purpose = ? AND t.used_at IS NULL AND t.expires_at > NOW()`,
    [hashToken(token), purpose],
  );
  return rows[0] ? { user_id: Number(rows[0].user_id), email: String(rows[0].email), first_name: String(rows[0].first_name) } : null;
}

/** Atomically: consume the token, expire the user's other reset tokens, set the password, clear the lock,
 *  bump session_version (signs out other devices), mark the email verified. Returns user_id or null. */
export async function resetPassword(token: string, passwordHash: string): Promise<number | null> {
  if (!token) return null;
  await ensureAuthV2Schema();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT token_id, user_id FROM auth_tokens
        WHERE token_hash = ? AND purpose = 'reset' AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`,
      [hashToken(token)],
    );
    if (!rows.length) { await conn.rollback(); return null; }
    const userId = Number(rows[0].user_id);
    await conn.execute(`UPDATE auth_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL`, [userId]);
    await conn.execute(
      `UPDATE user_login SET password = ?, failed_attempts = 0, last_attempt = NULL,
              session_version = session_version + 1, email_verified_at = COALESCE(email_verified_at, NOW())
        WHERE user_id = ?`,
      [passwordHash, userId],
    );
    await conn.commit();
    return userId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function consumeVerifyToken(token: string): Promise<number | null> {
  if (!token) return null;
  await ensureAuthV2Schema();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT user_id FROM auth_tokens
        WHERE token_hash = ? AND purpose = 'verify' AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`,
      [hashToken(token)],
    );
    if (!rows.length) { await conn.rollback(); return null; }
    const userId = Number(rows[0].user_id);
    await conn.execute(`UPDATE auth_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = 'verify' AND used_at IS NULL`, [userId]);
    await conn.execute(`UPDATE user_login SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE user_id = ?`, [userId]);
    await conn.commit();
    return userId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
```

- [ ] **Step 4: Write `mailer.ts`**

```ts
/* Sends transactional email from a Gmail account via an App Password (spec D8). Swap this module for
   Resend once a domain exists. Never throws to callers: auth flows must not fail because email did. */
import nodemailer from 'nodemailer';
import type { MailContent } from '@/lib/email/templates';

let transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  transport ??= nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return transport;
}

export async function sendMail(m: MailContent & { to: string }): Promise<boolean> {
  const t = getTransport();
  if (!t) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`[mail] GMAIL_USER / GMAIL_APP_PASSWORD not set; "${m.subject}" to ${m.to} was not sent`);
    } else {
      console.log(`\n[mail:dev] to=${m.to} subject="${m.subject}"\n${m.text}\n`);
    }
    return false;
  }
  try {
    await t.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'VibeBoard'}" <${process.env.GMAIL_USER}>`,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
    });
    return true;
  } catch (err) {
    console.error('[mail] send failed:', err);
    return false;
  }
}
```

- [ ] **Step 5: Document the env vars**

In `.env.example`, replace the `# Google sign-in (optional)` block with:

```
# Google sign-in — https://console.cloud.google.com/apis/credentials
# Add http://localhost:3000 under "Authorized JavaScript origins" and
# http://localhost:3000/api/auth/callback/google under "Authorized redirect URIs".
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Same value as GOOGLE_CLIENT_ID; exposed to the browser for the personalized "Continue as" button.
NEXT_PUBLIC_GOOGLE_CLIENT_ID=

# Email (password reset + verification) — send from a Gmail account with a Google App Password
# (needs 2-Step Verification: https://myaccount.google.com/apppasswords). Leave blank in development
# to print emails to the dev-server console instead.
GMAIL_USER=
GMAIL_APP_PASSWORD=
EMAIL_FROM_NAME=VibeBoard
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `node scripts/auth-test.mjs`
Expected: still all PASS.

These modules are exercised live in Task 6.

- [ ] **Step 7: Commit**

```bash
git status --short
git add package.json package-lock.json .env.example src/lib/auth/users.ts src/lib/auth/authTokens.ts src/lib/email/mailer.ts
git commit -m "Add auth data access (users, tokens) and Gmail mailer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Google identity (ticket, ID token, resolver) and the Auth.js rewrite

**Files:**
- Create: `src/lib/auth/ticket.ts`, `src/lib/auth/googleIdToken.ts`, `src/lib/auth/resolveGoogle.ts`
- Rewrite: `src/auth.ts`
- Modify: `src/auth.config.ts`, `src/types/next-auth.d.ts`

**Interfaces:**
- Consumes:
  - Task 1: `cleanEmail`, `cleanName`, `nameError`, `passwordError`, `yearLevelFor`, `lockSecondsLeft`, `MAX_ATTEMPTS`, `LOCK_SECONDS`
  - Task 4: `users.ts` functions, `resetPassword`
- Produces:
  - `ticket.ts`:
    - `interface SignupTicket { sub: string; email: string; given_name: string; family_name: string; picture: string | null }`
    - `TICKET_COOKIE = 'vb_signup_ticket'`, `TICKET_MAX_AGE = 900`
    - `sealTicket(t: SignupTicket): Promise<string>`
    - `openTicket(value: string | null | undefined): Promise<SignupTicket | null>`
    - `ticketCookieOptions`
    - `ticketFromCookieHeader(header: string | null): string | null`
  - `googleIdToken.ts`:
    - `interface GoogleIdentity { sub: string; email: string; email_verified: boolean; given_name: string; family_name: string; picture: string | null }`
    - `verifyGoogleIdToken(credential: string): Promise<GoogleIdentity | null>`
  - `resolveGoogle.ts`:
    - `type GoogleOutcome = { kind: 'user'; user: AuthUser } | { kind: 'new'; ticket: SignupTicket } | { kind: 'unverified' } | { kind: 'conflict' }`
    - `resolveGoogle(id: GoogleIdentity): Promise<GoogleOutcome>`
  - Auth.js provider ids: `google`, `credentials`, `google-idtoken`, `google-finish`, `password-reset`.
  - `CredentialsSignin` codes:
    - `credentials`: `invalid`, `locked:<seconds>`
    - `google-idtoken`: `google`, `needs-finish`, `google-unverified`, `google-conflict`
    - `google-finish`: `ticket`, `name`
    - `password-reset`: `weak`, `reset-invalid`
  - The OAuth `signIn` callback redirects new users to `/api/auth/signup-ticket?t=<sealed>`, and failures to `/login?e=google-unverified` or `/login?e=google-conflict`.

- [ ] **Step 1: Write `ticket.ts`**

```ts
/* The sign-up ticket (spec D12): Google's verified identity, sealed with Auth.js's JWE encode (AUTH_SECRET,
   own salt), lives 15 minutes in an httpOnly cookie. Only our route handlers set or clear the cookie. */
import { encode, decode } from 'next-auth/jwt';

export interface SignupTicket { sub: string; email: string; given_name: string; family_name: string; picture: string | null }

export const TICKET_COOKIE = 'vb_signup_ticket';
export const TICKET_MAX_AGE = 900;
const SALT = 'vb-signup-ticket';

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

export function sealTicket(t: SignupTicket): Promise<string> {
  return encode({ token: { ...t }, secret: secret(), salt: SALT, maxAge: TICKET_MAX_AGE });
}

export async function openTicket(value: string | null | undefined): Promise<SignupTicket | null> {
  if (!value) return null;
  try {
    const p = await decode({ token: value, secret: secret(), salt: SALT });
    if (!p || typeof p.sub !== 'string' || typeof p.email !== 'string') return null;
    return {
      sub: p.sub,
      email: p.email,
      given_name: typeof p.given_name === 'string' ? p.given_name : '',
      family_name: typeof p.family_name === 'string' ? p.family_name : '',
      picture: typeof p.picture === 'string' ? p.picture : null,
    };
  } catch {
    return null; // expired, tampered, or wrong secret
  }
}

export const ticketCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: TICKET_MAX_AGE,
};

/** Reads the ticket cookie from a raw Cookie header (Auth.js authorize() receives the Request). */
export function ticketFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === TICKET_COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}
```

- [ ] **Step 2: Write `googleIdToken.ts`**

```ts
/* Verifies a Google Identity Services credential (ID token) against Google's JWKS (spec §4.3). */
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface GoogleIdentity { sub: string; email: string; email_verified: boolean; given_name: string; family_name: string; picture: string | null }

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export async function verifyGoogleIdToken(credential: string): Promise<GoogleIdentity | null> {
  const audience = process.env.GOOGLE_CLIENT_ID;
  if (!audience || !credential) return null;
  try {
    const { payload } = await jwtVerify(credential, JWKS, {
      issuer: ['accounts.google.com', 'https://accounts.google.com'],
      audience,
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      email_verified: payload.email_verified === true || payload.email_verified === 'true',
      given_name: typeof payload.given_name === 'string' ? payload.given_name : '',
      family_name: typeof payload.family_name === 'string' ? payload.family_name : '',
      picture: typeof payload.picture === 'string' ? payload.picture : null,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Write `resolveGoogle.ts`**

```ts
/* One rule for every Google entry point (OAuth redirect, GIS button, finish page). Spec §4.2. */
import { findByEmail, findByGoogleSub, findById, linkGoogle, type AuthUser } from '@/lib/auth/users';
import type { GoogleIdentity } from '@/lib/auth/googleIdToken';
import type { SignupTicket } from '@/lib/auth/ticket';

export type GoogleOutcome =
  | { kind: 'user'; user: AuthUser }
  | { kind: 'new'; ticket: SignupTicket }
  | { kind: 'unverified' }
  | { kind: 'conflict' };

export async function resolveGoogle(id: GoogleIdentity): Promise<GoogleOutcome> {
  if (!id.email_verified) return { kind: 'unverified' };
  const bySub = await findByGoogleSub(id.sub);
  if (bySub) return { kind: 'user', user: bySub };
  const byEmail = await findByEmail(id.email);
  if (byEmail) {
    // The email is already linked to a different Google account: refuse rather than silently re-link.
    if (byEmail.google_sub && byEmail.google_sub !== id.sub) return { kind: 'conflict' };
    await linkGoogle(byEmail, id.sub);
    const linked = await findById(byEmail.user_id);
    return linked ? { kind: 'user', user: linked } : { kind: 'unverified' };
  }
  return {
    kind: 'new',
    ticket: { sub: id.sub, email: id.email, given_name: id.given_name, family_name: id.family_name, picture: id.picture },
  };
}
```

- [ ] **Step 4: Extend the types**

Replace `src/types/next-auth.d.ts` with:

```ts
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
```

- [ ] **Step 5: Rewrite `src/auth.ts`**

```ts
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

const SV_RECHECK_MS = Number(process.env.AUTH_SV_RECHECK_MS ?? 5 * 60 * 1000);
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
        if (out.kind === 'user') return asUser(out.user);
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
      const due = typeof token.sv !== 'number' || Date.now() - (token.svAt ?? 0) > SV_RECHECK_MS;
      if (due) {
        const sv = await getSessionVersion(Number(token.sub));
        if (sv === null) return null; // account deleted
        if (typeof token.sv === 'number' && sv !== token.sv) return null; // password reset elsewhere
        token.sv = sv; // tokens issued before session_version existed adopt the current value once
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
```

- [ ] **Step 6: Update `src/auth.config.ts` route lists**

Replace the two constants:

```ts
const PROTECTED  = ['/dashboard', '/studypulse', '/finance', '/habits', '/workboard'];
const AUTH_PAGES = ['/', '/login', '/signup', '/signup/finish', '/forgot-password'];
```

- [ ] **Step 7: Verify that the server boots and lists all five providers**

Run `npx tsc --noEmit`. Expected: no errors.

Start the dev server with `npm run dev` (background), then:

```bash
curl -s http://localhost:3000/api/auth/providers
```

Expected: JSON with the keys `google`, `credentials`, `google-idtoken`, `google-finish` and `password-reset`.

Log in at the **old** `/login` page with an existing account in the browser. Expected: it reaches `/dashboard`, which proves the `jwt` callback works.

- [ ] **Step 8: Commit**

```bash
git status --short
git add src/lib/auth/ticket.ts src/lib/auth/googleIdToken.ts src/lib/auth/resolveGoogle.ts src/auth.ts src/auth.config.ts src/types/next-auth.d.ts
git commit -m "Rewrite Auth.js config: Google resolver, sign-up ticket, GIS, reset provider, session_version

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Auth API routes

**Files:**
- Rewrite: `src/app/api/auth/signup/route.ts`
- Create: `src/app/api/auth/signup-ticket/route.ts`, `src/app/api/auth/google-onetap/route.ts`, `src/app/api/auth/password/forgot/route.ts`, `src/app/api/auth/verify/resend/route.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces (HTTP):
  - `POST /api/auth/signup` with `{first_name, last_name, email, password}` returns one of:
    - `201 {ok:true}`
    - `400 {errors: Partial<Record<'first_name'|'last_name'|'email'|'password', string>>}`
    - `409 {code:'email-taken'}`
    - `500 {error}`
  - `GET /api/auth/signup-ticket?t=` sets the cookie and redirects (`302`) to `/signup/finish`. A bad ticket redirects to `/signup?e=ticket`.
  - `DELETE /api/auth/signup-ticket` returns `204` and clears the cookie.
  - `POST /api/auth/google-onetap` with `{credential}` returns one of:
    - `200 {status:'existing'}`
    - `200 {status:'new'}` (and sets the cookie)
    - `400 {code:'google'|'google-unverified'|'google-conflict'}`
  - `POST /api/auth/password/forgot` with `{email}` always returns `200 {ok:true}`.
  - `POST /api/auth/verify/resend` returns one of:
    - `200 {ok:true}`
    - `200 {ok:true, already:true}`
    - `401`
    - `429 {code:'cooldown'}`

- [ ] **Step 1: Rewrite `src/app/api/auth/signup/route.ts`**

```ts
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
```

- [ ] **Step 2: Create `src/app/api/auth/signup-ticket/route.ts`**

```ts
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
```

- [ ] **Step 3: Create `src/app/api/auth/google-onetap/route.ts`**

```ts
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
```

- [ ] **Step 4: Create `src/app/api/auth/password/forgot/route.ts`**

```ts
import { after, type NextRequest } from 'next/server';
import { findByEmail } from '@/lib/auth/users';
import { issueToken } from '@/lib/auth/authTokens';
import { RESET_TTL_MIN } from '@/lib/auth/tokens';
import { cleanEmail, emailError } from '@/lib/auth/validate';
import { sendMail } from '@/lib/email/mailer';
import { resetMail, googleAccountMail, absoluteUrl } from '@/lib/email/templates';

/* Always answers the same way, and does the lookup after the response, so it never reveals whether
   an account exists (spec §4.6). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = cleanEmail(body?.email);
  if (!emailError(email)) {
    after(async () => {
      const u = await findByEmail(email);
      if (!u) return;
      const token = await issueToken(u.user_id, 'reset', RESET_TTL_MIN);
      if (!token) return; // cooldown
      const p = { firstName: u.first_name, url: absoluteUrl(`/reset-password?token=${token}`), minutes: RESET_TTL_MIN };
      await sendMail({ to: u.email, ...(u.password ? resetMail(p) : googleAccountMail(p)) });
    });
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 5: Create `src/app/api/auth/verify/resend/route.ts`**

```ts
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
```

- [ ] **Step 6: Live verification (dev server running, `GMAIL_*` unset so mail prints to the console)**

```bash
B=http://localhost:3000
curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/api/auth/signup -H "Content-Type: application/json" \
  -d '{"first_name":"QA","last_name":"Tester","email":"qa+auth1@example.com","password":"Juandelacruz7"}'
# expect 201; the dev console prints "[mail:dev] to=qa+auth1@example.com subject=\"Confirm your email for VibeBoard\""
curl -s -X POST $B/api/auth/signup -H "Content-Type: application/json" \
  -d '{"first_name":"QA","last_name":"Tester","email":"qa+auth1@example.com","password":"Juandelacruz7"}'
# expect {"code":"email-taken"}
curl -s -X POST $B/api/auth/signup -H "Content-Type: application/json" \
  -d '{"first_name":"Evil","last_name":"Squat","email":"victim@example.com","google":true}'
# expect 400 {"errors":{"password":"Enter a password."}} (forged google flag is ignored, spec §12.3)
curl -s -X POST $B/api/auth/password/forgot -H "Content-Type: application/json" -d '{"email":"qa+auth1@example.com"}'
curl -s -X POST $B/api/auth/password/forgot -H "Content-Type: application/json" -d '{"email":"nobody@example.com"}'
# both expect {"ok":true}; the console prints exactly one "[mail:dev] … Reset your VibeBoard password"
curl -s -X POST $B/api/auth/password/forgot -H "Content-Type: application/json" -d '{"email":"qa+auth1@example.com"}'
# within 60 s: {"ok":true} and NO new [mail:dev] line (cooldown)
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "$B/api/auth/signup-ticket?t=garbage"
# expect 307 or 302 → …/signup?e=ticket
/c/xampp/mysql/bin/mysql.exe -u root vibeboard -e "SELECT user_id, middle_name, year_level, LEFT(password,4) p, google_sub, email_verified_at FROM user_login WHERE email='qa+auth1@example.com'; SELECT purpose, COUNT(*) FROM auth_tokens t JOIN user_login u USING(user_id) WHERE u.email='qa+auth1@example.com' GROUP BY purpose;"
# expect: middle_name NULL, year_level NULL, p "$2b$" or "$2a$", google_sub NULL, email_verified_at NULL; verify 1, reset 1
```

Keep `qa+auth1@example.com` for Tasks 8–9. It's deleted in Task 13.

- [ ] **Step 7: Commit**

```bash
git status --short
git add src/app/api/auth/signup/route.ts src/app/api/auth/signup-ticket/route.ts src/app/api/auth/google-onetap/route.ts src/app/api/auth/password/forgot/route.ts src/app/api/auth/verify/resend/route.ts
git commit -m "Add auth API routes: minimal sign-up, sign-up ticket, GIS, forgot password, resend verification

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Public shell, `public.css` and auth UI components

**Files:**
- Modify: `src/app/layout.tsx` (add `suppressHydrationWarning` on `<html>`)
- Create: `src/app/(public)/layout.tsx`, `src/app/(public)/public.css`
- Create in `src/components/public/auth/`: `AuthShell.tsx`, `Field.tsx`, `PasswordField.tsx`, `GoogleButton.tsx`, `GooglePersonalized.tsx`, `YearPicker.tsx`, `DaypartGreeting.tsx`, `FormAlert.tsx`

**Interfaces:**
- Consumes:
  - `daypartScript`, `DAYPART_COPY`, `formatWhen`, `type Daypart` (Task 1)
  - `scorePassword` (Task 2)
  - `YEAR_OPTIONS`, `YearOption` (Task 1)
- Produces (React components):
  - `AuthShell({ topRight: ReactNode; children: ReactNode })`
  - `Field({ id, label, icon?, type?, value, onChange, onBlur?, error?, hint?, valid?, autoComplete?, inputMode?, labelAside?, readOnly?, required?, inputRef? })`
  - `PasswordField({ id, label, value, onChange, onBlur?, error?, autoComplete, meter?, labelAside?, inputRef? })`
  - `GoogleButton({ label?: string; prompt?: 'select_account' })`
  - `GooglePersonalized({ onCredential: (c: string) => void; fallbackLabel?: string })`
  - `YearPicker({ value: YearOption | null; onChange: (v: YearOption | null) => void })`
  - `DaypartGreeting({ page: 'login' | 'signup' })`, which renders the time chip, `<h1>` and subline for all four dayparts, switched by CSS
  - `FormAlert({ tone: 'error' | 'warn' | 'info'; children })`
  - CSS classes used by Tasks 8–11: `.pub-root`, `.auth-shell`, `.auth-card`, `.auth-h1`, `.auth-sub`, `.auth-or`, `.auth-btn`, `.auth-btn--ghost`, `.auth-link`, `.auth-fine`, `.auth-row2`, `.auth-ident`, `.auth-steps`, `.auth-badge`, `.pub-sample`

- [ ] **Step 1: Root layout**

In `src/app/layout.tsx`, change `<html lang="en">` to `<html lang="en" suppressHydrationWarning>`, and add the comment `{/* suppressHydrationWarning: (public)/layout sets data-daypart before hydration. */}` on the line above it.

- [ ] **Step 2: `src/app/(public)/layout.tsx`**

```tsx
import { daypartScript } from '@/lib/auth/daypart';
import './public.css';

/* Shared by the landing and every auth page. The inline script picks the sky (data-daypart on <html>)
   from the visitor's own clock before first paint (spec §6.1). The server default is "afternoon" (CSS). */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: daypartScript(process.env.NODE_ENV !== 'production') }} />
      {children}
    </>
  );
}
```

- [ ] **Step 3: `src/app/(public)/public.css` (auth part; the landing and motion parts are appended in Tasks 10 and 11)**

```css
/* Public pages: landing + auth (spec §6). Tokens are --pub-*; nothing here leaks into the app shell
   because every rule is scoped under .pub-root. */
.pub-root {
  --pub-ink: #1f1b2b; --pub-mute: #6b6478; --pub-soft: #8f879c; --pub-field: #d9d3e2; --pub-field-bg: #fbfafc;
  --pub-line: rgba(31, 27, 43, .08);
  --pub-pink: #d9628c; --pub-pink-soft: #fde3ec; --pub-blue: #3d8fbf; --pub-blue-soft: #dcf0fb;
  --pub-lav: #8a78c4; --pub-lav-soft: #ece6fb; --pub-green: #2f9a64; --pub-green-soft: #ddf5e8;
  --pub-red: #c4485a; --pub-red-soft: #fdecee; --pub-amber: #a5671a; --pub-amber-soft: #fdf3e1;
  --pub-card: #ffffff; --pub-logo-a: var(--pub-pink); --pub-logo-b: var(--pub-blue);
  --pub-ease: cubic-bezier(.23, 1, .32, 1);
  font-family: var(--font-dm-sans), system-ui, sans-serif;
  color: var(--pub-ink);
  min-height: 100dvh;
  -webkit-tap-highlight-color: transparent;
}
.pub-root *, .pub-root *::before, .pub-root *::after { box-sizing: border-box; }
.pub-root a { color: inherit; }
.pub-root :focus-visible { outline: 2.5px solid var(--pub-pink); outline-offset: 2px; border-radius: 8px; }
.pub-logo { font-weight: 800; font-size: 18px; letter-spacing: -.02em; text-decoration: none; }
.pub-logo b { color: var(--pub-logo-a); font-weight: 800; } .pub-logo i { color: var(--pub-logo-b); font-style: normal; }
.pub-sample { position: absolute; right: 14px; bottom: -10px; font-size: 11px; font-weight: 600; color: var(--pub-mute);
  background: #fff; border: 1px solid var(--pub-line); border-radius: 999px; padding: 2px 9px; }
.pub-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* ── Auth shell + sky (four dayparts) ── */
.auth-shell { position: relative; min-height: 100dvh; overflow: hidden; display: flex; flex-direction: column;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  background: linear-gradient(180deg, #e3f1fb 0%, #eef5fc 45%, #fbeef4 100%); }
.auth-sky { position: absolute; inset: 0; pointer-events: none; }
.auth-glow { position: absolute; border-radius: 50%; }
.auth-glow--a { right: -90px; top: -90px; width: 380px; height: 380px;
  background: radial-gradient(closest-side, rgba(255, 250, 236, .95), rgba(220, 240, 251, .5) 55%, transparent); }
.auth-glow--b { left: -60px; top: 34%; width: 260px; height: 52px; border-radius: 99px; background: rgba(255, 255, 255, .75); filter: blur(4px); }
.auth-glow--c { right: 6%; bottom: 18%; width: 200px; height: 40px; border-radius: 99px; background: rgba(255, 255, 255, .65); filter: blur(4px); }
.auth-stars { display: none; }
html[data-daypart="morning"] .auth-shell { background: linear-gradient(180deg, #ffe8dc 0%, #fff1ea 45%, #fdeef4 100%); }
html[data-daypart="morning"] .auth-glow--a { left: 50%; right: auto; top: auto; bottom: -200px; width: 640px; height: 420px; margin-left: -320px;
  background: radial-gradient(closest-side, rgba(255, 210, 180, .85), rgba(255, 226, 210, .4) 55%, transparent); }
html[data-daypart="morning"] .auth-glow--b { left: 8%; top: 28%; width: 220px; height: 220px; border-radius: 50%; filter: none;
  background: radial-gradient(closest-side, rgba(242, 167, 192, .35), transparent); }
html[data-daypart="morning"] .auth-glow--c { display: none; }
html[data-daypart="evening"] .auth-shell { background: linear-gradient(180deg, #ece6fb 0%, #f7e6f1 50%, #ffe6dc 100%); }
html[data-daypart="evening"] .auth-glow--a { left: -120px; right: auto; top: auto; bottom: -170px; width: 560px; height: 420px;
  background: radial-gradient(closest-side, rgba(255, 205, 180, .85), rgba(249, 197, 209, .4) 55%, transparent); }
html[data-daypart="evening"] .auth-glow--b { left: auto; right: 6%; top: 16%; width: 240px; height: 240px; border-radius: 50%; filter: none;
  background: radial-gradient(closest-side, rgba(169, 154, 216, .35), transparent); }
html[data-daypart="evening"] .auth-glow--c { display: none; }
html[data-daypart="night"] .pub-root { --pub-ink: #f4f1fb; --pub-mute: #b4accb; --pub-soft: #8c84a6; --pub-field: rgba(255, 255, 255, .16);
  --pub-field-bg: #1b172e; --pub-line: rgba(255, 255, 255, .1); --pub-card: #221d38; --pub-logo-a: #f2a7c0; --pub-logo-b: #91cbe6; }
html[data-daypart="night"] .auth-shell { background: linear-gradient(180deg, #1d1934 0%, #28224a 55%, #3a2f5e 100%); color-scheme: dark; }
html[data-daypart="night"] .auth-glow--a { left: -80px; right: auto; top: auto; bottom: -110px; width: 420px; height: 320px;
  background: radial-gradient(closest-side, rgba(242, 167, 192, .22), transparent); }
html[data-daypart="night"] .auth-glow--b { left: auto; right: -50px; top: -40px; width: 340px; height: 280px; border-radius: 50%; filter: none;
  background: radial-gradient(closest-side, rgba(145, 203, 230, .18), transparent); }
html[data-daypart="night"] .auth-glow--c { right: 36px; bottom: auto; top: 74px; width: 34px; height: 34px; border-radius: 50%; filter: none;
  background: transparent; box-shadow: -8px 5px 0 0 #f6ecff; }
html[data-daypart="night"] .auth-stars { display: block; position: absolute; inset: 0;
  background-image: radial-gradient(1.2px 1.2px at 18% 14%, #ffe3ec, transparent), radial-gradient(1px 1px at 72% 9%, #dcf0fb, transparent),
    radial-gradient(1.6px 1.6px at 88% 30%, #fff, transparent), radial-gradient(1px 1px at 38% 24%, #ece6fb, transparent),
    radial-gradient(1px 1px at 8% 44%, #fff, transparent), radial-gradient(1.2px 1.2px at 62% 40%, #ffe3ec, transparent),
    radial-gradient(1px 1px at 92% 70%, #dcf0fb, transparent), radial-gradient(1px 1px at 5% 80%, #fff, transparent); }

.auth-top { position: relative; display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; font-size: 14px; }
.auth-top .auth-switch { color: var(--pub-mute); text-decoration: none; }
.auth-top .auth-switch b { color: var(--pub-ink); }
.auth-main { position: relative; flex: 1; display: grid; place-items: center; padding: 8px 16px 40px; }
.auth-card { width: 100%; max-width: 400px; background: var(--pub-card); border-radius: 20px; padding: 26px 24px;
  border: 1px solid var(--pub-line); box-shadow: 0 1px 0 rgba(31, 27, 43, .04), 0 28px 60px -28px rgba(31, 27, 43, .45); }
html[data-daypart="night"] .auth-card { box-shadow: 0 28px 60px -24px rgba(0, 0, 0, .6); }
@media (max-width: 420px) { .auth-card { padding: 22px 16px; border-radius: 18px; } .auth-top { padding: 14px 16px; } }

/* Daypart-switched text: every variant is in the HTML; CSS shows the right one (no flash). */
.dp > [data-dp] { display: none; }
.dp > [data-dp="afternoon"] { display: revert; }
html[data-daypart] .dp > [data-dp="afternoon"] { display: none; }
html[data-daypart="morning"] .dp > [data-dp="morning"], html[data-daypart="afternoon"] .dp > [data-dp="afternoon"],
html[data-daypart="evening"] .dp > [data-dp="evening"], html[data-daypart="night"] .dp > [data-dp="night"] { display: revert; }

.auth-when { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; font-size: 12px; font-weight: 700; padding: 3px 10px;
  border-radius: 999px; margin-bottom: 12px; background: var(--pub-blue-soft); color: var(--pub-blue); }
html[data-daypart="morning"] .auth-when { background: #ffeadf; color: #b65a2c; }
html[data-daypart="evening"] .auth-when { background: var(--pub-lav-soft); color: #6f5db0; }
html[data-daypart="night"] .auth-when { background: rgba(242, 167, 192, .14); color: #f2a7c0; }
.auth-h1 { font-size: 28px; line-height: 1.08; letter-spacing: -.035em; font-weight: 700; margin: 0; }
.auth-h1 em { font-style: normal; color: var(--pub-pink); }
html[data-daypart="night"] .auth-h1 em { color: #f2a7c0; }
.auth-sub { font-size: 14px; line-height: 1.45; color: var(--pub-mute); margin: 6px 0 18px; }

/* ── Fields ── */
.auth-field { margin-bottom: 14px; }
.auth-label { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 13px; font-weight: 700; margin: 0 0 6px; }
.auth-label .opt { font-weight: 500; color: var(--pub-soft); }
.auth-label a, .auth-label button.auth-link { font-size: 13px; }
.auth-control { position: relative; display: flex; align-items: center; height: 46px; border: 1.5px solid var(--pub-field); border-radius: 12px;
  background: var(--pub-field-bg); transition: border-color .15s var(--pub-ease), box-shadow .15s var(--pub-ease), background-color .15s var(--pub-ease); }
.auth-control > svg { flex: 0 0 auto; margin-left: 12px; color: var(--pub-soft); }
.auth-control input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--pub-ink);
  font: 500 16px/1 var(--font-dm-sans), system-ui, sans-serif; padding: 0 12px 0 10px; }
.auth-control input::placeholder { color: var(--pub-soft); font-weight: 400; }
.auth-control:focus-within { border-color: var(--pub-pink); background: var(--pub-card); box-shadow: 0 0 0 3.5px rgba(217, 98, 140, .16); }
.auth-control:focus-within > svg { color: var(--pub-pink); }
.auth-control.is-valid { border-color: #b9e2cb; }
.auth-control.is-invalid { border-color: var(--pub-red); }
.auth-control.is-warn { border-color: #e8c88f; }
.auth-control.is-readonly { border-style: dashed; background: transparent; }
.auth-control .auth-ok { margin-right: 12px; color: var(--pub-green); }
.auth-eye { height: 100%; padding: 0 14px; border: 0; background: none; color: var(--pub-mute); font: 600 13px var(--font-dm-sans), sans-serif; cursor: pointer; border-radius: 0 12px 12px 0; }
.auth-hint { font-size: 13px; line-height: 1.4; margin: 6px 0 0; color: var(--pub-mute); }
.auth-hint.is-error { color: var(--pub-red); }
.auth-hint.is-warn { color: var(--pub-amber); }
html[data-daypart="night"] .auth-hint.is-error { color: #ff9aab; }
.auth-hint button, .auth-hint a { font: inherit; font-weight: 700; color: var(--pub-pink); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: none; }
.auth-meter { display: flex; gap: 4px; margin-top: 8px; }
.auth-meter i { flex: 1; height: 4px; border-radius: 9px; background: var(--pub-line); transition: background-color .2s var(--pub-ease); }
.auth-meter[data-score="1"] i:nth-child(-n+1) { background: var(--pub-red); }
.auth-meter[data-score="2"] i:nth-child(-n+2) { background: var(--pub-amber); }
.auth-meter[data-score="3"] i:nth-child(-n+3), .auth-meter[data-score="4"] i { background: var(--pub-green); }
.auth-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 340px) { .auth-row2 { grid-template-columns: 1fr; } }

/* ── Buttons, divider, links ── */
.auth-btn { display: inline-flex; width: 100%; align-items: center; justify-content: center; gap: 8px; min-height: 46px; border-radius: 12px;
  border: 1.5px solid var(--pub-ink); background: var(--pub-ink); color: var(--pub-card); font: 700 15px var(--font-dm-sans), sans-serif;
  cursor: pointer; text-decoration: none; transition: transform .12s var(--pub-ease), opacity .15s var(--pub-ease); }
.auth-btn:active:not(:disabled) { transform: scale(.97); }
.auth-btn:disabled { opacity: .6; cursor: not-allowed; }
.auth-btn--ghost { background: var(--pub-card); color: var(--pub-ink); border-color: var(--pub-field); }
.auth-btn--google { background: var(--pub-card); color: var(--pub-ink); border-color: var(--pub-field); }
.auth-or { display: flex; align-items: center; gap: 12px; font-size: 12px; font-weight: 600; letter-spacing: .04em; color: var(--pub-soft); margin: 18px 0 16px; text-transform: uppercase; }
.auth-or::before, .auth-or::after { content: ''; flex: 1; height: 1px; background: var(--pub-line); }
.auth-link { color: var(--pub-pink); font-weight: 600; text-decoration: none; background: none; border: 0; padding: 0; cursor: pointer; font-family: inherit; }
html[data-daypart="night"] .auth-link { color: #f2a7c0; }
.auth-link--quiet { color: var(--pub-mute); text-decoration: underline; text-underline-offset: 2px; font-weight: 500; }
.auth-fine { font-size: 12.5px; line-height: 1.5; color: var(--pub-mute); text-align: center; margin: 14px 0 0; }
.auth-fine a { color: var(--pub-ink); font-weight: 600; text-decoration: none; }
.auth-center { text-align: center; margin-top: 10px; }
.pub-gis { display: flex; justify-content: center; min-height: 44px; }

/* ── Alerts, identity card, steps, year picker, badge icon ── */
.auth-alert { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; line-height: 1.45; border-radius: 12px; padding: 11px 12px; margin-bottom: 16px; }
.auth-alert--error { background: var(--pub-red-soft); color: var(--pub-red); }
.auth-alert--warn { background: var(--pub-amber-soft); color: var(--pub-amber); }
.auth-alert--info { background: var(--pub-blue-soft); color: #2d6f96; }
.auth-alert svg { flex: 0 0 auto; margin-top: 2px; }
.auth-ident { display: flex; align-items: center; gap: 12px; border: 1.5px solid var(--pub-field); border-radius: 14px; padding: 10px 12px; margin-bottom: 16px; }
.auth-ident img, .auth-ident .auth-avatar { width: 36px; height: 36px; border-radius: 50%; flex: 0 0 auto; object-fit: cover; }
.auth-avatar { display: grid; place-items: center; color: #fff; font-weight: 700; background: linear-gradient(135deg, #f2a7c0, #91cbe6); }
.auth-ident .who { flex: 1; min-width: 0; line-height: 1.3; }
.auth-ident .who b { display: block; font-size: 14px; overflow-wrap: anywhere; }
.auth-ident .who span { font-size: 12.5px; color: var(--pub-green); font-weight: 600; }
.auth-steps { display: flex; gap: 6px; margin-bottom: 14px; }
.auth-steps i { width: 24px; height: 4px; border-radius: 9px; background: var(--pub-line); }
.auth-steps i.on { background: var(--pub-pink); }
.auth-years { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.auth-years button { min-height: 44px; border: 1.5px solid var(--pub-field); border-radius: 11px; background: var(--pub-card); color: var(--pub-mute);
  font: 700 14px var(--font-dm-sans), sans-serif; cursor: pointer; transition: transform .12s var(--pub-ease), background-color .15s var(--pub-ease); }
.auth-years button[aria-checked="true"] { border-color: var(--pub-pink); background: var(--pub-pink-soft); color: var(--pub-pink); }
.auth-years button:active { transform: scale(.96); }
.auth-badge { width: 50px; height: 50px; border-radius: 15px; display: grid; place-items: center; margin-bottom: 14px; }
.auth-badge--pink { background: var(--pub-pink-soft); color: var(--pub-pink); }
.auth-badge--blue { background: var(--pub-blue-soft); color: var(--pub-blue); }
.auth-badge--green { background: var(--pub-green-soft); color: var(--pub-green); }

@media (hover: hover) {
  .auth-btn:hover:not(:disabled) { opacity: .92; }
  .auth-btn--ghost:hover, .auth-btn--google:hover { background: var(--pub-field-bg); opacity: 1; }
  .auth-link:hover { text-decoration: underline; }
}
@media (prefers-reduced-motion: reduce) {
  .pub-root *, .pub-root *::before, .pub-root *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
```

- [ ] **Step 4: Components**

`src/components/public/auth/AuthShell.tsx`:

```tsx
import Link from 'next/link';

/* Sky + top bar + centred card (spec §6). The sky follows <html data-daypart> via public.css. */
export default function AuthShell({ topRight, children }: { topRight: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pub-root">
      <div className="auth-shell">
        <div className="auth-sky" aria-hidden="true">
          <div className="auth-stars" />
          <div className="auth-glow auth-glow--a" />
          <div className="auth-glow auth-glow--b" />
          <div className="auth-glow auth-glow--c" />
        </div>
        <header className="auth-top">
          <Link href="/" className="pub-logo" aria-label="VibeBoard home"><b>Vibe</b><i>Board</i></Link>
          {topRight}
        </header>
        <main className="auth-main">
          <div className="auth-card">{children}</div>
        </main>
      </div>
    </div>
  );
}
```

`src/components/public/auth/FormAlert.tsx`:

```tsx
import { AlertCircle, Clock, Info } from 'lucide-react';

export default function FormAlert({ tone, children }: { tone: 'error' | 'warn' | 'info'; children: React.ReactNode }) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'warn' ? Clock : Info;
  return (
    <div className={`auth-alert auth-alert--${tone}`} role="alert">
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
```

`src/components/public/auth/Field.tsx`:

```tsx
'use client';
import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface FieldProps {
  id: string;
  label: string;
  icon?: LucideIcon;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: React.ReactNode;
  hint?: React.ReactNode;
  warn?: boolean;
  valid?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  placeholder?: string;
  labelAside?: React.ReactNode;
  readOnly?: boolean;
  required?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  trailing?: React.ReactNode;
}

/* Labelled input with icon, inline hint/error wired via aria-describedby (spec §6.2, §10). */
export default function Field(p: FieldProps) {
  const describedBy = p.error || p.hint ? `${p.id}-msg` : undefined;
  const state = p.error ? 'is-invalid' : p.warn ? 'is-warn' : p.valid ? 'is-valid' : '';
  const Icon = p.icon;
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={p.id}>
        <span>{p.label}</span>
        {p.labelAside}
      </label>
      <div className={`auth-control ${state} ${p.readOnly ? 'is-readonly' : ''}`}>
        {Icon && <Icon size={17} aria-hidden="true" />}
        <input
          id={p.id}
          ref={p.inputRef}
          type={p.type ?? 'text'}
          value={p.value}
          onChange={e => p.onChange(e.target.value)}
          onBlur={p.onBlur}
          autoComplete={p.autoComplete}
          inputMode={p.inputMode}
          placeholder={p.placeholder}
          readOnly={p.readOnly}
          required={p.required}
          aria-invalid={p.error ? true : undefined}
          aria-describedby={describedBy}
          spellCheck={false}
        />
        {p.trailing}
        {p.valid && !p.error && !p.trailing && <Check size={17} className="auth-ok" aria-hidden="true" />}
      </div>
      {(p.error || p.hint) && (
        <p id={`${p.id}-msg`} className={`auth-hint ${p.error ? 'is-error' : p.warn ? 'is-warn' : ''}`} aria-live="polite">
          {p.error ?? p.hint}
        </p>
      )}
    </div>
  );
}
```

`src/components/public/auth/PasswordField.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { Lock } from 'lucide-react';
import Field from './Field';
import { scorePassword } from '@/lib/auth/passwordStrength';

export default function PasswordField(p: {
  id: string; label: string; value: string; onChange: (v: string) => void; onBlur?: () => void;
  error?: React.ReactNode; autoComplete: 'current-password' | 'new-password'; meter?: boolean;
  labelAside?: React.ReactNode; inputRef?: React.Ref<HTMLInputElement>; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const s = p.meter && p.value ? scorePassword(p.value) : null;
  return (
    <>
      <Field
        id={p.id} label={p.label} icon={Lock} type={show ? 'text' : 'password'} value={p.value} onChange={p.onChange}
        onBlur={p.onBlur} error={p.error} autoComplete={p.autoComplete} labelAside={p.labelAside} inputRef={p.inputRef}
        placeholder={p.placeholder ?? 'Your password'} required
        hint={s ? <span>{s.label}{s.hint ? ` · ${s.hint}` : ''}</span> : undefined}
        trailing={
          <button type="button" className="auth-eye" onClick={() => setShow(v => !v)} aria-pressed={show}
            aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? 'Hide' : 'Show'}
          </button>
        }
      />
      {s && (
        <div className="auth-meter" data-score={s.score} aria-hidden="true" style={{ marginTop: -8, marginBottom: 14 }}>
          <i /><i /><i /><i />
        </div>
      )}
    </>
  );
}
```

`src/components/public/auth/GoogleButton.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';

export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

/* Standard OAuth redirect button. Also the fallback when Google's personalized button can't load. */
export default function GoogleButton({ label = 'Continue with Google', prompt }: { label?: string; prompt?: 'select_account' }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="auth-btn auth-btn--google" disabled={busy}
      onClick={() => { setBusy(true); void signIn('google', { redirectTo: '/dashboard' }, prompt ? { prompt } : undefined); }}>
      <GoogleMark />
      {busy ? 'Opening Google…' : label}
    </button>
  );
}
```

`src/components/public/auth/GooglePersonalized.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import GoogleButton from './GoogleButton';

type GsiId = {
  initialize: (o: Record<string, unknown>) => void;
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
};
declare global { interface Window { google?: { accounts?: { id?: GsiId } } } }

/* Google's own personalized "Continue as …" button (spec §4.3, D7). Falls back to the plain OAuth button
   if the script is blocked, slow (>3 s), or NEXT_PUBLIC_GOOGLE_CLIENT_ID is missing. Never auto-selects. */
export default function GooglePersonalized({ onCredential, fallbackLabel }: { onCredential: (c: string) => void; fallbackLabel?: string }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [failed, setFailed] = useState(!clientId);
  const [rendered, setRendered] = useState(false);

  const render = useCallback(() => {
    const gid = window.google?.accounts?.id;
    if (!gid || !host.current || !clientId) { setFailed(true); return; }
    gid.initialize({
      client_id: clientId,
      callback: (r: { credential?: string }) => { if (r.credential) cb.current(r.credential); },
      use_fedcm_for_button: true,
      auto_select: false,
      itp_support: true,
    });
    const night = document.documentElement.dataset.daypart === 'night';
    gid.renderButton(host.current, {
      type: 'standard', theme: night ? 'filled_black' : 'outline', shape: 'pill', size: 'large',
      text: 'continue_with', logo_alignment: 'left', width: Math.min(host.current.offsetWidth || 352, 400),
    });
    setRendered(true);
  }, [clientId]);

  useEffect(() => {
    if (failed) return;
    if (window.google?.accounts?.id) { render(); return; }
    const t = setTimeout(() => { if (!window.google?.accounts?.id) setFailed(true); }, 3000);
    return () => clearTimeout(t);
  }, [failed, render]);

  if (failed) return <GoogleButton label={fallbackLabel} />;
  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={render} onError={() => setFailed(true)} />
      <div ref={host} className="pub-gis" aria-busy={!rendered} />
    </>
  );
}
```

`src/components/public/auth/YearPicker.tsx`:

```tsx
'use client';
import { useRef } from 'react';
import { YEAR_OPTIONS, type YearOption } from '@/lib/auth/validate';

/* Radiogroup with roving focus. Tapping the selected year again clears it (the question is optional). */
export default function YearPicker({ value, onChange }: { value: YearOption | null; onChange: (v: YearOption | null) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = value ? YEAR_OPTIONS.indexOf(value) : -1;
  const move = (i: number) => {
    const n = (i + YEAR_OPTIONS.length) % YEAR_OPTIONS.length;
    onChange(YEAR_OPTIONS[n]);
    refs.current[n]?.focus();
  };
  return (
    <div className="auth-years" role="radiogroup" aria-labelledby="year-label">
      {YEAR_OPTIONS.map((y, i) => (
        <button
          key={y} type="button" role="radio" ref={el => { refs.current[i] = el; }}
          aria-checked={value === y}
          tabIndex={current === -1 ? (i === 0 ? 0 : -1) : (current === i ? 0 : -1)}
          onClick={() => onChange(value === y ? null : y)}
          onKeyDown={e => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
          }}
        >
          {y}
        </button>
      ))}
    </div>
  );
}
```

`src/components/public/auth/DaypartGreeting.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun, Sunrise, Sunset } from 'lucide-react';
import { DAYPART_COPY, formatWhen, type Daypart } from '@/lib/auth/daypart';

const ICON: Record<Daypart, typeof Sun> = { morning: Sunrise, afternoon: Sun, evening: Sunset, night: Moon };
const ORDER: Daypart[] = ['morning', 'afternoon', 'evening', 'night'];

/* All four variants render on the server; public.css shows the one matching <html data-daypart>. The clock
   text needs the visitor's time, so it fills in after mount (the chip keeps its height meanwhile). */
export default function DaypartGreeting({ page }: { page: 'login' | 'signup' }) {
  const [when, setWhen] = useState('');
  useEffect(() => {
    const tick = () => setWhen(formatWhen(new Date()));
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <div className="auth-when dp" aria-hidden={!when}>
        {ORDER.map(d => { const I = ICON[d]; return <span key={d} data-dp={d}><I size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />{when}</span>; })}
      </div>
      {page === 'login' ? (
        <>
          <h1 className="auth-h1 dp">{ORDER.map(d => <span key={d} data-dp={d}>{DAYPART_COPY[d].greeting}</span>)}</h1>
          <p className="auth-sub dp">{ORDER.map(d => <span key={d} data-dp={d}>{DAYPART_COPY[d].login}</span>)}</p>
        </>
      ) : null}
    </>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

The components aren't mounted yet; Task 8 mounts them.

- [ ] **Step 6: Commit**

```bash
git status --short
git add src/app/layout.tsx "src/app/(public)/layout.tsx" "src/app/(public)/public.css" src/components/public/auth
git commit -m "Add public shell, daypart sky styles and auth form components

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Login page

**Files:**
- Create: `src/app/(public)/login/page.tsx`, `src/components/public/auth/LoginForm.tsx`
- Delete: `src/app/login/page.tsx`

**Interfaces:**
- Consumes:
  - From Task 7: `AuthShell`, `Field`, `PasswordField`, `GooglePersonalized`, `GoogleButton`, `DaypartGreeting`, `FormAlert`
  - From Task 6: the `google-onetap` route
  - From Task 5: the error codes
- Produces: `sessionStorage['vb-forgot-email']`, which is read by Task 9's `ForgotForm`.

- [ ] **Step 1: `src/components/public/auth/LoginForm.tsx`**

```tsx
'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Check, Mail } from 'lucide-react';
import Field from './Field';
import PasswordField from './PasswordField';
import GooglePersonalized from './GooglePersonalized';
import DaypartGreeting from './DaypartGreeting';
import FormAlert from './FormAlert';

const URL_ERRORS: Record<string, string> = {
  'google-unverified': "Google didn't confirm that email address. Try another Google account, or log in with email.",
  'google-conflict': 'That email is already linked to a different Google account. Use that Google account, or log in with email.',
  OAuthAccountNotLinked: 'That email is already linked to a different Google account.',
  AccessDenied: "Google sign-in didn't finish. Please try again.",
  Configuration: "Google sign-in isn't available right now. Log in with email instead.",
};
const INVALID = "That email and password don't match. Check for typos, or continue with Google if that's how you signed up.";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const urlError = params.get('e') ?? params.get('error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(urlError ? URL_ERRORS[urlError] ?? URL_ERRORS.AccessDenied : null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => { setNow(Date.now()); if (Date.now() >= lockedUntil) setLockedUntil(null); }, 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const succeed = () => {
    setDone(true);
    setTimeout(() => { router.push('/dashboard'); router.refresh(); }, 400);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || lockedUntil) return;
    setBusy(true); setError(null);
    const r = await signIn('credentials', { email, password, redirect: false });
    setBusy(false);
    if (r?.ok && !r.error) return succeed();
    const code = r?.code ?? '';
    if (code.startsWith('locked:')) { setLockedUntil(Date.now() + Number(code.slice(7)) * 1000); setNow(Date.now()); return; }
    setError(INVALID);
    setPassword('');
    pwRef.current?.focus();
  }

  async function onGoogleCredential(credential: string) {
    setError(null);
    const res = await fetch('/api/auth/google-onetap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }),
    });
    const data = (await res.json().catch(() => ({}))) as { status?: string; code?: string };
    if (data.status === 'new') { router.push('/signup/finish'); return; }
    if (data.status === 'existing') {
      const r = await signIn('google-idtoken', { credential, redirect: false });
      if (r?.ok && !r.error) return succeed();
    }
    setError(URL_ERRORS[data.code ?? ''] ?? URL_ERRORS.AccessDenied);
  }

  const secsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  const lockText = secsLeft >= 60 ? `${Math.ceil(secsLeft / 60)} minutes` : `${secsLeft} seconds`;

  return (
    <>
      <DaypartGreeting page="login" />
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {lockedUntil && <FormAlert tone="warn">Too many attempts. Try again in <b>{lockText}</b>, or continue with Google.</FormAlert>}

      <GooglePersonalized onCredential={onGoogleCredential} />
      <p className="auth-center"><UseAnother /></p>

      <div className="auth-or">or log in with email</div>
      <form onSubmit={onSubmit} noValidate>
        <Field id="email" label="Email" icon={Mail} type="email" value={email} onChange={setEmail}
          autoComplete="email" inputMode="email" placeholder="you@school.edu.ph" required />
        <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password"
          inputRef={pwRef}
          labelAside={
            <Link href="/forgot-password" className="auth-link"
              onClick={() => { try { sessionStorage.setItem('vb-forgot-email', email); } catch { /* storage blocked */ } }}>
              Forgot password?
            </Link>
          } />
        <button type="submit" className="auth-btn" disabled={busy || !!lockedUntil || done}>
          {done ? <><Check size={18} aria-hidden="true" /> Logged in</> : busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </>
  );
}

/* "Use another account": the OAuth chooser, so a shared PC never reuses the last Google session silently. */
function UseAnother() {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="auth-link auth-link--quiet" disabled={busy}
      onClick={() => { setBusy(true); void signIn('google', { redirectTo: '/dashboard' }, { prompt: 'select_account' }); }}>
      Use another account
    </button>
  );
}
```

- [ ] **Step 2: `src/app/(public)/login/page.tsx`**

```tsx
import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import AuthShell from '@/components/public/auth/AuthShell';
import LoginForm from '@/components/public/auth/LoginForm';

export const metadata: Metadata = { title: 'Log in · VibeBoard' };

export default function LoginPage() {
  return (
    <AuthShell topRight={<Link href="/signup" className="auth-switch">New here? <b>Sign up</b></Link>}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
```

- [ ] **Step 3: Delete the old page**

Run: `git rm src/app/login/page.tsx`

- [ ] **Step 4: Verify in the browser (Playwright MCP or a real browser, dev server running)**

1. Open `/login?daypart=morning`, `?daypart=afternoon`, `?daypart=evening` and `?daypart=night`. Each shows the matching sky, chip, headline and subline from spec §6.1. Night shows a dark card with light text.
2. Wrong password for `qa+auth1@example.com`:
   - The generic `INVALID` message appears.
   - The password field clears and keeps focus.
3. After 5 wrong attempts: the lock alert shows "Too many attempts. Try again in 10 minutes", and the button is disabled.
4. Reset the lock with `/c/xampp/mysql/bin/mysql.exe -u root vibeboard -e "UPDATE user_login SET failed_attempts=0,last_attempt=NULL WHERE email='qa+auth1@example.com'"`.
5. Log in with `Juandelacruz7`: the button shows "✓ Logged in" and lands on `/dashboard`.
6. Sign out, then **Continue with Google** with an existing Google-linked or matching account: lands on `/dashboard`.
7. If `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is unset, the plain "Continue with Google" button shows instead (fallback).
8. At 390px wide: no horizontal scroll, and inputs don't zoom on focus (16px).

- [ ] **Step 5: Commit**

```bash
git status --short
git add "src/app/(public)/login/page.tsx" src/components/public/auth/LoginForm.tsx
git commit -m "Rebuild login: time-of-day sky, Google personalized button, clear errors and lockout countdown

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Sign-up, finish setting up, forgot, reset and verify pages

**Files:**
- Create: `src/components/public/auth/SignupForm.tsx`, `FinishForm.tsx`, `ForgotForm.tsx`, `ResetForm.tsx`
- Create: `src/app/(public)/signup/page.tsx`, `src/app/(public)/signup/finish/page.tsx`, `src/app/(public)/forgot-password/page.tsx`, `src/app/(public)/reset-password/page.tsx`, `src/app/(public)/verify-email/page.tsx`
- Delete: `src/app/signup/page.tsx`

**Interfaces:**
- Consumes:
  - Tasks 1, 2, 5, 6 and 7
  - `openTicket`, `TICKET_COOKIE` (Task 5)
  - `peekToken`, `consumeVerifyToken` (Task 4)
- Produces: nothing new.

- [ ] **Step 1: `SignupForm.tsx`**

```tsx
'use client';
import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Mail, User } from 'lucide-react';
import Field from './Field';
import PasswordField from './PasswordField';
import GoogleButton from './GoogleButton';
import FormAlert from './FormAlert';
import { cleanEmail, cleanName, emailError, nameError, passwordError } from '@/lib/auth/validate';
import { suggestEmail } from '@/lib/auth/emailTypo';

type Key = 'first_name' | 'last_name' | 'email' | 'password';

export default function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [v, setV] = useState({ first_name: '', last_name: '', email: '', password: '' });
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [serverErr, setServerErr] = useState<Partial<Record<Key, React.ReactNode>>>({});
  const [formErr, setFormErr] = useState<string | null>(params.get('e') === 'ticket' ? 'Your Google sign-in timed out. Please continue with Google again.' : null);
  const [taken, setTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const refs = { first_name: useRef<HTMLInputElement>(null), last_name: useRef<HTMLInputElement>(null), email: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null) };

  const clientErr = (k: Key): string | null => {
    if (k === 'first_name') return nameError(cleanName(v.first_name), 'first name');
    if (k === 'last_name') return nameError(cleanName(v.last_name), 'last name');
    if (k === 'email') return emailError(cleanEmail(v.email));
    return passwordError(v.password);
  };
  const shown = (k: Key) => serverErr[k] ?? (touched[k] ? clientErr(k) : null);
  const set = (k: Key) => (val: string) => { setV(p => ({ ...p, [k]: val })); setServerErr(p => ({ ...p, [k]: undefined })); if (k === 'email') setTaken(false); };
  const blur = (k: Key) => () => setTouched(p => ({ ...p, [k]: true }));
  const suggestion = touched.email && !emailError(cleanEmail(v.email)) ? suggestEmail(v.email.trim()) : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const keys: Key[] = ['first_name', 'last_name', 'email', 'password'];
    setTouched({ first_name: true, last_name: true, email: true, password: true });
    const firstBad = keys.find(k => clientErr(k));
    if (firstBad) { refs[firstBad].current?.focus(); return; }
    setBusy(true); setFormErr(null);
    const res = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
    const data = (await res.json().catch(() => ({}))) as { errors?: Partial<Record<Key, string>>; code?: string; error?: string };
    if (res.status === 409 && data.code === 'email-taken') {
      setBusy(false); setTaken(true);
      setServerErr({ email: <>This email already has an account. <Link href="/login">Log in instead</Link> or <Link href="/forgot-password" onClick={() => { try { sessionStorage.setItem('vb-forgot-email', cleanEmail(v.email)); } catch { /* storage blocked */ } }}>reset your password</Link>.</> });
      refs.email.current?.focus();
      return;
    }
    if (!res.ok) {
      setBusy(false);
      if (data.errors) { setServerErr(data.errors); const k = keys.find(x => data.errors?.[x]); if (k) refs[k].current?.focus(); }
      else setFormErr(data.error ?? 'Something went wrong on our side. Please try again.');
      return;
    }
    const r = await signIn('credentials', { email: cleanEmail(v.email), password: v.password, redirect: false });
    if (r?.ok && !r.error) { router.push('/dashboard'); router.refresh(); return; }
    router.push('/login');
  }

  return (
    <>
      <h1 className="auth-h1">Create your <em>board.</em></h1>
      <p className="auth-sub">Free for students. Takes under a minute.</p>
      {formErr && <FormAlert tone="error">{formErr}</FormAlert>}
      <GoogleButton />
      <div className="auth-or">or sign up with email</div>
      <form onSubmit={onSubmit} noValidate>
        <div className="auth-row2">
          <Field id="first_name" label="First name" icon={User} value={v.first_name} onChange={set('first_name')} onBlur={blur('first_name')}
            autoComplete="given-name" error={shown('first_name')} valid={touched.first_name && !shown('first_name')} inputRef={refs.first_name} required />
          <Field id="last_name" label="Last name" value={v.last_name} onChange={set('last_name')} onBlur={blur('last_name')}
            autoComplete="family-name" error={shown('last_name')} valid={touched.last_name && !shown('last_name')} inputRef={refs.last_name} required />
        </div>
        <Field id="email" label="Email" icon={Mail} type="email" value={v.email} onChange={set('email')} onBlur={blur('email')}
          autoComplete="email" inputMode="email" placeholder="you@school.edu.ph" inputRef={refs.email} required
          error={shown('email')} warn={!!suggestion && !taken} valid={touched.email && !shown('email') && !suggestion}
          hint={suggestion ? <>Did you mean <button type="button" onClick={() => setV(p => ({ ...p, email: suggestion }))}>{suggestion}</button>?</> : undefined} />
        <PasswordField id="password" label="Password" value={v.password} onChange={set('password')} onBlur={blur('password')}
          autoComplete="new-password" meter error={shown('password')} inputRef={refs.password} placeholder="At least 8 characters" />
        <button type="submit" className="auth-btn" disabled={busy}>{busy ? 'Creating your board…' : 'Create account'}</button>
      </form>
      <p className="auth-fine">By continuing you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
    </>
  );
}
```

- [ ] **Step 2: `FinishForm.tsx`**

```tsx
'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { ArrowRight, User } from 'lucide-react';
import Field from './Field';
import YearPicker from './YearPicker';
import FormAlert from './FormAlert';
import { cleanName, nameError, type YearOption } from '@/lib/auth/validate';

export interface FinishIdentity { email: string; given_name: string; family_name: string; picture: string | null }

export default function FinishForm({ identity }: { identity: FinishIdentity }) {
  const router = useRouter();
  const [first, setFirst] = useState(identity.given_name);
  const [last, setLast] = useState(identity.family_name);
  const [year, setYear] = useState<YearOption | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fErr = touched ? nameError(cleanName(first), 'first name') : null;
  const lErr = touched ? nameError(cleanName(last), 'last name') : null;
  const hello = cleanName(first) || 'there';

  async function cancel() {
    await fetch('/api/auth/signup-ticket', { method: 'DELETE' });
    router.push('/login');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (nameError(cleanName(first), 'first name') || nameError(cleanName(last), 'last name')) return;
    setBusy(true); setError(null);
    const r = await signIn('google-finish', { first_name: first, last_name: last, year: year ?? '', redirect: false });
    if (r?.ok && !r.error) {
      await fetch('/api/auth/signup-ticket', { method: 'DELETE' });
      router.push('/dashboard'); router.refresh();
      return;
    }
    setBusy(false);
    if (r?.code === 'ticket') { router.push('/signup?e=ticket'); return; }
    setError(r?.code === 'name' ? 'Check your name. Letters, spaces, apostrophes, periods and hyphens only.' : 'Something went wrong. Please try again.');
  }

  return (
    <>
      <div className="auth-steps" aria-hidden="true"><i className="on" /><i className="on" /></div>
      <h1 className="auth-h1">Nice to meet you, <em>{hello}.</em></h1>
      <p className="auth-sub">Check these details and you&apos;re in.</p>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <div className="auth-ident">
        {identity.picture
          // eslint-disable-next-line @next/next/no-img-element -- Google avatar host isn't in next/image config; tiny, decorative.
          ? <img src={identity.picture} alt="" referrerPolicy="no-referrer" />
          : <span className="auth-avatar" aria-hidden="true">{identity.email.charAt(0).toUpperCase()}</span>}
        <div className="who"><b>{identity.email}</b><span>✓ Verified by Google</span></div>
        <button type="button" className="auth-link auth-link--quiet" onClick={cancel}>Not you?</button>
      </div>
      <form onSubmit={onSubmit} noValidate>
        <div className="auth-row2">
          <Field id="first_name" label="First name" icon={User} value={first} onChange={setFirst} onBlur={() => setTouched(true)} autoComplete="given-name" error={fErr} required />
          <Field id="last_name" label="Last name" value={last} onChange={setLast} onBlur={() => setTouched(true)} autoComplete="family-name" error={lErr} required />
        </div>
        <div className="auth-field">
          <p className="auth-label" id="year-label"><span>What year are you in?</span><span className="opt">Optional</span></p>
          <YearPicker value={year} onChange={setYear} />
          <p className="auth-hint">We&apos;ll pre-fill it when you add subjects.</p>
        </div>
        <button type="submit" className="auth-btn" disabled={busy}>{busy ? 'Opening your board…' : <>Open my board <ArrowRight size={18} aria-hidden="true" /></>}</button>
      </form>
      <p className="auth-fine">By continuing you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
    </>
  );
}
```

- [ ] **Step 3: `ForgotForm.tsx`**

```tsx
'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Mail, MailCheck } from 'lucide-react';
import Field from './Field';
import { cleanEmail, emailError } from '@/lib/auth/validate';
import { RESEND_COOLDOWN_SEC } from '@/lib/auth/tokens';

export default function ForgotForm() {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => { try { const s = sessionStorage.getItem('vb-forgot-email'); if (s) setEmail(s); } catch { /* storage blocked */ } }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const err = touched ? emailError(cleanEmail(email)) : null;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setTouched(true);
    const clean = cleanEmail(email);
    if (emailError(clean)) return;
    setBusy(true);
    await fetch('/api/auth/password/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: clean }) });
    setBusy(false); setSentTo(clean); setCooldown(RESEND_COOLDOWN_SEC);
  }

  if (sentTo) {
    const m = Math.floor(cooldown / 60), s = String(cooldown % 60).padStart(2, '0');
    return (
      <>
        <div className="auth-badge auth-badge--blue"><MailCheck size={24} aria-hidden="true" /></div>
        <h1 className="auth-h1">Check your email.</h1>
        <p className="auth-sub" role="status">If an account exists for <b>{sentTo}</b>, a reset link is on its way. It works once and expires in <b>30 minutes</b>.</p>
        <button type="button" className="auth-btn auth-btn--ghost" disabled={cooldown > 0 || busy} onClick={() => send()}>
          {cooldown > 0 ? `Resend in ${m}:${s}` : busy ? 'Sending…' : 'Resend link'}
        </button>
        <p className="auth-fine">Not seeing it? Check spam, or <button type="button" className="auth-link" onClick={() => { setSentTo(null); setCooldown(0); }}>use a different email</button>.</p>
      </>
    );
  }
  return (
    <>
      <div className="auth-badge auth-badge--pink"><KeyRound size={24} aria-hidden="true" /></div>
      <h1 className="auth-h1">Forgot your password?</h1>
      <p className="auth-sub">Enter your email and we&apos;ll send you a link to set a new one.</p>
      <form onSubmit={send} noValidate>
        <Field id="email" label="Email" icon={Mail} type="email" value={email} onChange={setEmail} onBlur={() => setTouched(true)}
          autoComplete="email" inputMode="email" placeholder="you@school.edu.ph" error={err} required />
        <button type="submit" className="auth-btn" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      <p className="auth-fine">Signed up with Google? Just use <b>Continue with Google</b> on the login page.</p>
    </>
  );
}
```

- [ ] **Step 4: `ResetForm.tsx`**

```tsx
'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { LockKeyhole } from 'lucide-react';
import PasswordField from './PasswordField';
import { passwordError } from '@/lib/auth/validate';

export default function ResetForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [touched, setTouched] = useState(false);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const err = touched ? passwordError(pw) : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (passwordError(pw)) return;
    setBusy(true);
    const r = await signIn('password-reset', { token, password: pw, redirect: false });
    if (r?.ok && !r.error) { router.push('/dashboard'); router.refresh(); return; }
    setBusy(false);
    if (r?.code === 'reset-invalid') setExpired(true);
  }

  if (expired) return <ExpiredLink email={email} />;
  return (
    <>
      <div className="auth-badge auth-badge--green"><LockKeyhole size={24} aria-hidden="true" /></div>
      <h1 className="auth-h1">Set a new password.</h1>
      <p className="auth-sub">For <b>{email}</b></p>
      <form onSubmit={onSubmit} noValidate>
        {/* Hidden username helps password managers save the new password against the right account. */}
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <PasswordField id="password" label="New password" value={pw} onChange={setPw} onBlur={() => setTouched(true)}
          autoComplete="new-password" meter error={err} placeholder="At least 8 characters" />
        <button type="submit" className="auth-btn" disabled={busy}>{busy ? 'Saving…' : 'Save and log in'}</button>
      </form>
    </>
  );
}

export function ExpiredLink({ email }: { email?: string }) {
  return (
    <>
      <div className="auth-badge auth-badge--pink"><LockKeyhole size={24} aria-hidden="true" /></div>
      <h1 className="auth-h1">This link has expired.</h1>
      <p className="auth-sub">Reset links work once and last 30 minutes. Get a fresh one. It only takes a second.</p>
      <Link href="/forgot-password" className="auth-btn"
        onClick={() => { try { if (email) sessionStorage.setItem('vb-forgot-email', email); } catch { /* storage blocked */ } }}>
        Send a new link
      </Link>
    </>
  );
}
```

- [ ] **Step 5: Pages**

`src/app/(public)/signup/page.tsx`:

```tsx
import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import AuthShell from '@/components/public/auth/AuthShell';
import SignupForm from '@/components/public/auth/SignupForm';

export const metadata: Metadata = { title: 'Create your account · VibeBoard' };

export default function SignupPage() {
  return (
    <AuthShell topRight={<Link href="/login" className="auth-switch">Have an account? <b>Log in</b></Link>}>
      <Suspense fallback={null}><SignupForm /></Suspense>
    </AuthShell>
  );
}
```

`src/app/(public)/signup/finish/page.tsx`:

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import AuthShell from '@/components/public/auth/AuthShell';
import FinishForm from '@/components/public/auth/FinishForm';
import { openTicket, TICKET_COOKIE } from '@/lib/auth/ticket';

export const metadata: Metadata = { title: 'Finish setting up · VibeBoard' };

export default async function FinishPage() {
  const ticket = await openTicket((await cookies()).get(TICKET_COOKIE)?.value);
  if (!ticket) redirect('/signup?e=ticket');
  return (
    <AuthShell topRight={null}>
      <FinishForm identity={{ email: ticket.email, given_name: ticket.given_name, family_name: ticket.family_name, picture: ticket.picture }} />
    </AuthShell>
  );
}
```

`src/app/(public)/forgot-password/page.tsx`:

```tsx
import Link from 'next/link';
import type { Metadata } from 'next';
import AuthShell from '@/components/public/auth/AuthShell';
import ForgotForm from '@/components/public/auth/ForgotForm';

export const metadata: Metadata = { title: 'Reset your password · VibeBoard' };

export default function ForgotPage() {
  return (
    <AuthShell topRight={<Link href="/login" className="auth-switch">← <b>Back to log in</b></Link>}>
      <ForgotForm />
    </AuthShell>
  );
}
```

`src/app/(public)/reset-password/page.tsx`:

```tsx
import type { Metadata } from 'next';
import AuthShell from '@/components/public/auth/AuthShell';
import ResetForm, { ExpiredLink } from '@/components/public/auth/ResetForm';
import { peekToken } from '@/lib/auth/authTokens';

export const metadata: Metadata = { title: 'Set a new password · VibeBoard', referrer: 'no-referrer' };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const rec = await peekToken(token, 'reset');
  return (
    <AuthShell topRight={null}>
      {rec ? <ResetForm token={token} email={rec.email} /> : <ExpiredLink />}
    </AuthShell>
  );
}
```

`src/app/(public)/verify-email/page.tsx`:

```tsx
import Link from 'next/link';
import type { Metadata } from 'next';
import { MailCheck, MailX } from 'lucide-react';
import AuthShell from '@/components/public/auth/AuthShell';
import { consumeVerifyToken } from '@/lib/auth/authTokens';

export const metadata: Metadata = { title: 'Confirm your email · VibeBoard', referrer: 'no-referrer' };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const ok = (await consumeVerifyToken(token)) !== null;
  return (
    <AuthShell topRight={null}>
      {ok ? (
        <>
          <div className="auth-badge auth-badge--green"><MailCheck size={24} aria-hidden="true" /></div>
          <h1 className="auth-h1">Email confirmed.</h1>
          <p className="auth-sub">You can always reset your password now.</p>
          <Link href="/dashboard" className="auth-btn">Open my board</Link>
        </>
      ) : (
        <>
          <div className="auth-badge auth-badge--pink"><MailX size={24} aria-hidden="true" /></div>
          <h1 className="auth-h1">This link has expired.</h1>
          <p className="auth-sub">Confirmation links last 24 hours and work once. Open your board and choose <b>Resend</b> on the banner to get a new one.</p>
          <Link href="/dashboard" className="auth-btn auth-btn--ghost">Open my board</Link>
        </>
      )}
    </AuthShell>
  );
}
```

- [ ] **Step 6: Delete the old sign-up page**

Run: `git rm src/app/signup/page.tsx`

- [ ] **Step 7: Verify (dev server running, mail prints to the console)**

**Email sign-up**
1. Sign up with `qa+auth2@example.com`.
   - Typing `gmial.com` and leaving the field shows "Did you mean …@gmail.com?", and clicking it fixes the email.
   - The meter shows labels from Task 2.
   - Submitting lands on `/dashboard` (auto login, fixes P9).
2. Sign up again with `qa+auth1@example.com`: the inline "already has an account" message appears with both links, and focus moves to the email field.

**Password reset**
1. From `/login`, type `qa+auth1@example.com`, click **Forgot password?**: the field is prefilled.
2. Send it. The screen shows "Check your email" with the resend countdown, and the dev console prints the reset link.
3. Open the link: "Set a new password" shows the email. Save `Juan dela Cruz 2026!`: lands on `/dashboard`.
4. Reopen the same link: "This link has expired" with **Send a new link**.
5. **Session revocation:** with `AUTH_SV_RECHECK_MS=10000` in `.env.local` and the dev server restarted:
   - Log in as `qa+auth1` in a second browser profile.
   - Reset the password in the first profile.
   - Within 10 s the second profile's next `/dashboard` load redirects to `/login`.
   - Remove `AUTH_SV_RECHECK_MS` afterwards.

**Email verification**
- Open the verify link from the sign-up console mail: "Email confirmed." Then run `SELECT email_verified_at FROM user_login WHERE email='qa+auth2@example.com'`: the value is not NULL.

**Google (needs a real Google account that isn't registered yet)**
1. **Continue with Google** goes to `/signup/finish`.
   - The name is prefilled, and the headline updates while typing.
   - "Not you?" returns to `/login`, and the cookie is gone (DevTools → Application → Cookies).
2. Continue again and finish with year **2nd**: lands on `/dashboard`. In the DB, `password IS NULL`, `google_sub` is set, `year_level='2nd Year'` and `email_verified_at` is set.
3. Opening `/signup/finish` with no ticket redirects to `/signup?e=ticket` and shows the timed-out alert.

**Account linking (spec D11)**
- Run `UPDATE user_login SET email_verified_at=NULL WHERE email='<your google email>'` on a password account you control, then **Continue with Google**.
- In the DB, `password` is now NULL and `session_version` went up by 1.
- Restore it afterwards with `/forgot-password`.

- [ ] **Step 8: Commit**

```bash
git status --short
git add src/components/public/auth/SignupForm.tsx src/components/public/auth/FinishForm.tsx src/components/public/auth/ForgotForm.tsx src/components/public/auth/ResetForm.tsx "src/app/(public)/signup" "src/app/(public)/forgot-password" "src/app/(public)/reset-password" "src/app/(public)/verify-email"
git commit -m "Rebuild sign-up; add Google finish step, password reset and email verification pages

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Landing page

**Files:**
- Create in `src/components/public/landing/`: `LandingNav.tsx`, `Hero.tsx`, `HeroStudyCard.tsx`, `ProblemCta.tsx`, `DayArc.tsx`, `StudyPulseSection.tsx`, `LandingFooter.tsx`
- Create: `src/app/(public)/page.tsx`
- Modify: `src/app/(public)/public.css` (append the landing section)
- Delete: `src/app/page.tsx`

**Interfaces:**
- Consumes: `GoogleButton` (Task 7), `.pub-root` tokens.
- Produces: the hooks for Task 11: `data-reveal`, `.lp-chip--float`, `.lp-x`, `.lp-arc`, `[data-countup]`, `.lp-bars i`.

- [ ] **Step 1: Components**

`LandingNav.tsx`:

```tsx
import Link from 'next/link';

export default function LandingNav() {
  return (
    <header className="lp-nav">
      <Link href="/" className="pub-logo" aria-label="VibeBoard home"><b>Vibe</b><i>Board</i></Link>
      <nav aria-label="Account" className="lp-nav__actions">
        <Link href="/login" className="lp-btn">Log in</Link>
        <Link href="/signup" className="lp-btn lp-btn--dark">Get started</Link>
      </nav>
    </header>
  );
}
```

`HeroStudyCard.tsx` (every number is sample data, spec §5.3):

```tsx
const BARS: { code: string; pct: number; best?: boolean }[] = [
  { code: 'ETHICS', pct: 62 }, { code: 'DISCMATH', pct: 74 }, { code: 'CALC2', pct: 58 }, { code: 'OOP', pct: 80 }, { code: 'DSA', pct: 94, best: true },
];

export default function HeroStudyCard() {
  return (
    <div className="lp-hero-visual" aria-label="Example of a StudyPulse grade summary (sample data)" role="img">
      <div className="lp-card lp-card--hero" data-reveal="card">
        <div className="lp-k">StudyPulse · 2nd Trimester</div>
        <div className="lp-big"><span data-countup="1.42">1.42</span></div>
        <div className="lp-mute">Midterm GWA estimate</div>
        <div className="lp-bars" aria-hidden="true">
          {BARS.map(b => (
            <div key={b.code}><i className={b.best ? 'is-best' : ''} style={{ height: `${b.pct}%` }} /><span>{b.code}</span></div>
          ))}
        </div>
        <div className="lp-row"><span>Calc 2 · need on what&apos;s left</span><span><b className="lp-num">78%</b> <span className="lp-tag lp-tag--green">Achievable</span></span></div>
        <span className="pub-sample">Sample data</span>
      </div>
      <span className="lp-chip lp-chip--float" style={{ right: 0, top: -10 }}><span className="dot" style={{ background: 'var(--pub-pink)' }} />Quiz 4 · Fri</span>
      <span className="lp-chip lp-chip--float" style={{ left: -18, bottom: 54 }}><span className="dot" style={{ background: 'var(--pub-blue)' }} />₱420 safe to spend</span>
      <span className="lp-chip lp-chip--float" style={{ right: 8, bottom: -2 }}><span className="dot" style={{ background: 'var(--pub-green)' }} />Reading · day 12</span>
    </div>
  );
}
```

`Hero.tsx`:

```tsx
import HeroStudyCard from './HeroStudyCard';

export default function Hero() {
  return (
    <section className="lp-hero" aria-labelledby="lp-title">
      <div className="lp-hero__copy">
        <p className="lp-triad" data-reveal>Plan it. <b>Track it.</b> Ace it.</p>
        <h1 id="lp-title" className="lp-h1" data-reveal>Ace the semester.<br /><em>Keep the rest in check.</em></h1>
        <p className="lp-lede" data-reveal>Your grades come first. Deadlines, money and habits sit right beside them, each one a few taps away.</p>
      </div>
      <HeroStudyCard />
    </section>
  );
}
```

`ProblemCta.tsx`:

```tsx
import Link from 'next/link';
import GoogleButton from '@/components/public/auth/GoogleButton';

const OLD_WAY = ['Grades in a spreadsheet', 'Deadlines in 3 group chats', 'Budget in your head', 'Habits on sticky notes'];

export default function ProblemCta() {
  return (
    <section className="lp-problem" aria-labelledby="lp-problem-title">
      <p className="lp-eyebrow lp-eyebrow--mute">Sound familiar?</p>
      <h2 id="lp-problem-title" className="lp-h2">Five apps for one semester.</h2>
      <ul className="lp-xchips" data-xchips>
        {OLD_WAY.map(t => <li key={t} className="lp-chip lp-x"><span aria-hidden="true" className="lp-xmark">✕</span>{t}</li>)}
      </ul>
      <div className="lp-cta">
        <h2 className="lp-h2 lp-h2--big">Make this your <em>calmest semester.</em></h2>
        <p className="lp-mute lp-mute--lg">One board for grades, deadlines, money and habits.</p>
        <div className="lp-cta__buttons">
          <Link href="/signup" className="lp-btn lp-btn--dark lp-btn--lg">Create free account</Link>
          <div className="lp-cta__google"><GoogleButton /></div>
        </div>
        <p className="lp-reassure"><span>Free for students</span><span>Sign up in under a minute</span></p>
      </div>
    </section>
  );
}
```

`DayArc.tsx`:

```tsx
const MOMENTS = [
  { time: '7:30 AM', tag: 'Study', tone: 'pink', lead: 'Quiz today.', rest: 'Already on your board.' },
  { time: '12:10 PM', tag: 'Money', tone: 'blue', lead: '₱95 lunch', rest: 'logged in seconds.' },
  { time: '4:00 PM', tag: 'Work', tone: 'lav', lead: 'Org deck', rest: 'moved to Thursday.' },
  { time: '10:00 PM', tag: 'Habits', tone: 'green', lead: 'Day 12', rest: 'of your reading streak.' },
] as const;

export default function DayArc() {
  return (
    <section className="lp-day" aria-labelledby="lp-day-title">
      <p className="lp-eyebrow">A day with VibeBoard</p>
      <h2 id="lp-day-title" className="lp-h2">Every part of your day, <em>a few seconds each.</em></h2>
      <div className="lp-arc" data-arc>
        <svg className="lp-arc__svg" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="lp-arc-grad" x1="0" x2="1"><stop offset="0" stopColor="#f2a7c0" /><stop offset=".5" stopColor="#91cbe6" /><stop offset="1" stopColor="#a99ad8" /></linearGradient>
          </defs>
          <path d="M0,180 C90,20 310,20 400,180" fill="none" stroke="url(#lp-arc-grad)" strokeWidth="3" strokeDasharray="2 6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="lp-arc__sun" aria-hidden="true" />
        <ol className="lp-moments">
          {MOMENTS.map(m => (
            <li key={m.time} className="lp-moment">
              <span className="lp-time">{m.time}</span>
              <div className="lp-card lp-card--moment">
                <span className={`lp-tag lp-tag--${m.tone}`}>{m.tag}</span>
                <p><b>{m.lead}</b> {m.rest}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

`StudyPulseSection.tsx`:

```tsx
const CLAIMS = [
  "Weighted grades per subject, on your school's 1.0 or 4.0 scale",
  "The average you need on what's left to hit your target",
  'GWA calculator that can read a screenshot of your grades',
  'Pulls deadlines from Canvas, if your school uses it',
];
// Sample GWA: (1.25·3 + 1.50·3 + 1.75·2) / 8 = 1.469 → 1.47 (spec §5.3)
const ROWS = [
  { name: 'Data Structures', units: 3, grade: '1.25' },
  { name: 'Discrete Math', units: 3, grade: '1.50' },
  { name: 'Ethics', units: 2, grade: '1.75' },
];

export default function StudyPulseSection() {
  return (
    <section className="lp-sp" aria-labelledby="lp-sp-title">
      <div>
        <p className="lp-eyebrow">StudyPulse</p>
        <h2 id="lp-sp-title" className="lp-h2">Know your grade<br /><em>before finals do.</em></h2>
        <ul className="lp-claims">{CLAIMS.map(c => <li key={c}>{c}</li>)}</ul>
      </div>
      <div className="lp-card lp-card--gwa" role="img" aria-label="Example GWA calculation (sample data): 1.47">
        <div className="lp-k">GWA calculator</div>
        {ROWS.map((r, i) => (
          <div key={r.name} className={`lp-row ${i === 0 ? 'lp-row--first' : ''}`}><span>{r.name} <small>{r.units} units</small></span><b className="lp-num">{r.grade}</b></div>
        ))}
        <div className="lp-row"><span><b>GWA</b></span><b className="lp-num lp-num--lg">1.47</b></div>
        <span className="pub-sample">Sample data</span>
      </div>
    </section>
  );
}
```

`LandingFooter.tsx`:

```tsx
import Link from 'next/link';

export default function LandingFooter() {
  return (
    <footer className="lp-foot">
      <span>© 2026 VibeBoard · Made by students, for students</span>
      <nav aria-label="Legal"><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></nav>
    </footer>
  );
}
```

`src/app/(public)/page.tsx`:

```tsx
import type { Metadata } from 'next';
import LandingNav from '@/components/public/landing/LandingNav';
import Hero from '@/components/public/landing/Hero';
import ProblemCta from '@/components/public/landing/ProblemCta';
import DayArc from '@/components/public/landing/DayArc';
import StudyPulseSection from '@/components/public/landing/StudyPulseSection';
import LandingFooter from '@/components/public/landing/LandingFooter';

export const metadata: Metadata = {
  title: 'VibeBoard · Ace the semester. Keep the rest in check.',
  description: 'Grades, deadlines, money and habits on one calm board. Free for students.',
};

export default function LandingPage() {
  return (
    <div className="pub-root lp">
      <div className="lp-glow lp-glow--peach" aria-hidden="true" />
      <div className="lp-glow lp-glow--pink" aria-hidden="true" />
      <LandingNav />
      <main>
        <Hero />
        <ProblemCta />
        <DayArc />
        <StudyPulseSection />
      </main>
      <LandingFooter />
    </div>
  );
}
```

- [ ] **Step 2: Append the landing CSS to `public.css`**

```css
/* ── Landing (spec §5, mockup landing-f1-v6) ── */
.lp { position: relative; overflow: hidden;
  background: linear-gradient(180deg, #fff6f1 0%, #fdeef4 16%, #f6f2fb 36%, #eaf5fc 58%, #eef0fb 80%, #ece8f6 100%); }
.lp-glow { position: absolute; pointer-events: none; border-radius: 50%; }
.lp-glow--peach { left: -12%; top: -90px; width: 72%; height: 620px; background: radial-gradient(closest-side, rgba(255, 196, 160, .55), transparent); }
.lp-glow--pink { right: -14%; top: 10px; width: 62%; height: 560px; background: radial-gradient(closest-side, rgba(242, 167, 192, .45), transparent); }
.lp > * { position: relative; }
.lp-nav { display: flex; align-items: center; justify-content: space-between; max-width: 1120px; margin: 0 auto; padding: 18px 24px; }
.lp-nav__actions { display: flex; gap: 8px; }
.lp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 20px; border-radius: 999px;
  border: 1px solid var(--pub-line); background: #fff; color: var(--pub-ink); font-weight: 600; font-size: 15px; text-decoration: none; white-space: nowrap;
  box-shadow: 0 1px 2px rgba(31, 27, 43, .06); transition: transform .12s var(--pub-ease); }
.lp-btn:active { transform: scale(.97); }
.lp-btn--dark { background: var(--pub-ink); color: #fff; border-color: var(--pub-ink); box-shadow: 0 8px 20px -8px rgba(31, 27, 43, .5); }
.lp-btn--lg { min-height: 52px; padding: 0 28px; font-size: 16px; }
.lp-hero { display: grid; grid-template-columns: 1fr 1.08fr; gap: 48px; align-items: center; max-width: 1120px; margin: 0 auto; padding: 56px 24px 72px; }
.lp-triad { font-size: 14px; font-weight: 700; color: var(--pub-mute); margin: 0 0 16px; }
.lp-triad b { color: var(--pub-pink); }
.lp-h1 { font-size: clamp(40px, 6vw, 68px); line-height: 1; letter-spacing: -.045em; font-weight: 700; margin: 0; }
.lp-h1 em, .lp-h2 em { font-style: normal; background: linear-gradient(90deg, var(--pub-pink), var(--pub-blue)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lp-lede { color: var(--pub-mute); font-size: 18px; line-height: 1.55; margin: 20px 0 0; max-width: 460px; }
.lp-hero-visual { position: relative; padding: 18px 18px 22px 22px; }
.lp-card { position: relative; background: rgba(255, 255, 255, .92); border: 1px solid rgba(255, 255, 255, .95); border-radius: 20px; padding: 18px;
  box-shadow: 0 1px 0 rgba(31, 27, 43, .04), 0 18px 42px -20px rgba(31, 27, 43, .3); }
.lp-card--hero { padding: 22px; }
.lp-k { font-size: 11.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--pub-mute); font-weight: 700; }
.lp-big { font-size: 44px; font-weight: 700; letter-spacing: -.03em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.lp-mute { color: var(--pub-mute); font-size: 14px; line-height: 1.55; margin: 0; }
.lp-mute--lg { font-size: 17px; margin-top: 6px; }
.lp-bars { display: flex; align-items: flex-end; gap: 9px; height: 96px; margin-top: 14px; }
.lp-bars div { flex: 1; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; }
.lp-bars i { width: 100%; border-radius: 7px 7px 3px 3px; background: var(--pub-blue-soft); transform-origin: bottom; }
.lp-bars i.is-best { background: linear-gradient(var(--pub-pink), #f2a7c0); }
.lp-bars span { font-size: 10px; color: var(--pub-mute); font-weight: 600; }
.lp-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 14px; padding: 9px 0; border-top: 1px solid var(--pub-line); }
.lp-row--first { border-top: 0; }
.lp-row small { color: var(--pub-mute); font-size: 12px; }
.lp-num { font-variant-numeric: tabular-nums; }
.lp-num--lg { font-size: 20px; }
.lp-tag { display: inline-block; font-size: 11.5px; padding: 2px 9px; border-radius: 999px; font-weight: 700; }
.lp-tag--pink { background: var(--pub-pink-soft); color: #b8456f; } .lp-tag--blue { background: var(--pub-blue-soft); color: #2d6f96; }
.lp-tag--lav { background: var(--pub-lav-soft); color: #6f5db0; } .lp-tag--green { background: var(--pub-green-soft); color: #23784e; }
.lp-chip { position: absolute; display: inline-flex; align-items: center; gap: 7px; background: #fff; border-radius: 999px; padding: 8px 14px;
  font-size: 14px; font-weight: 600; white-space: nowrap; box-shadow: 0 10px 24px -12px rgba(31, 27, 43, .35); }
.lp-chip .dot { width: 8px; height: 8px; border-radius: 50%; }
.lp-problem { max-width: 900px; margin: 0 auto; padding: 56px 24px 24px; text-align: center; }
.lp-eyebrow { font-size: 12.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--pub-pink); margin: 0 0 6px; }
.lp-eyebrow--mute { color: var(--pub-mute); }
.lp-h2 { font-size: clamp(28px, 3.6vw, 40px); letter-spacing: -.035em; line-height: 1.08; margin: 0; font-weight: 700; }
.lp-h2--big { font-size: clamp(32px, 4.8vw, 52px); }
.lp-xchips { list-style: none; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 22px auto 40px; padding: 0; max-width: 620px; }
.lp-xchips .lp-chip { position: static; opacity: .9; }
.lp-xmark { color: var(--pub-red); font-weight: 700; }
.lp-cta { background: rgba(255, 255, 255, .58); border-radius: 28px; padding: 40px 20px; box-shadow: 0 1px 0 rgba(255, 255, 255, .8) inset; }
.lp-cta__buttons { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 22px; }
.lp-cta__google { min-width: 260px; }
.lp-cta__google .auth-btn { min-height: 52px; border-radius: 999px; font-size: 16px; }
.lp-reassure { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; font-size: 13.5px; color: var(--pub-mute); margin: 14px 0 0; }
.lp-reassure span::before { content: '✓ '; color: var(--pub-green); font-weight: 700; }
.lp-day { max-width: 1120px; margin: 0 auto; padding: 72px 24px 16px; }
.lp-arc { position: relative; height: 300px; margin-top: 18px; }
.lp-arc__svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.lp-arc__sun { position: absolute; left: 0; top: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; background: #fff;
  box-shadow: 0 0 0 4px rgba(255, 214, 170, .55), 0 0 24px 8px rgba(255, 214, 170, .55); opacity: 0; }
.lp-moments { list-style: none; margin: 0; padding: 0; }
.lp-moment { position: absolute; width: 23%; }
.lp-moment:nth-child(1) { left: 0; top: 150px; } .lp-moment:nth-child(2) { left: 25%; top: 24px; }
.lp-moment:nth-child(3) { left: 52%; top: 24px; } .lp-moment:nth-child(4) { right: 0; top: 150px; }
.lp-time { font-size: 12.5px; font-weight: 700; color: var(--pub-mute); font-variant-numeric: tabular-nums; }
.lp-card--moment { padding: 13px; margin-top: 6px; }
.lp-card--moment p { font-size: 14px; line-height: 1.45; margin: 7px 0 0; }
.lp-sp { display: grid; grid-template-columns: 1fr 1.05fr; gap: 40px; align-items: center; max-width: 1120px; margin: 0 auto; padding: 80px 24px 72px; }
.lp-claims { list-style: none; padding: 0; margin: 14px 0 0; color: var(--pub-mute); font-size: 15px; line-height: 1.55; }
.lp-claims li { padding-left: 24px; position: relative; margin: 6px 0; }
.lp-claims li::before { content: '✓'; position: absolute; left: 0; color: var(--pub-pink); font-weight: 700; }
.lp-card--gwa { border-radius: 24px; }
.lp-foot { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; max-width: 1120px; margin: 0 auto; padding: 22px 24px 28px; font-size: 13px; color: var(--pub-mute); }
.lp-foot a { text-decoration: none; }

@media (hover: hover) {
  .lp-btn:hover { background: #faf8fb; }
  .lp-btn--dark:hover { background: #2c2740; }
  .lp-foot a:hover { color: var(--pub-ink); }
}
@media (max-width: 880px) {
  .lp-hero, .lp-sp { grid-template-columns: 1fr; gap: 36px; }
  .lp-hero { padding-top: 32px; }
  .lp-arc { height: auto; }
  .lp-arc__svg, .lp-arc__sun { display: none; }
  .lp-moments { position: relative; display: grid; gap: 14px; padding-left: 22px; border-left: 2px dashed rgba(169, 154, 216, .5); }
  .lp-moment { position: static; width: auto; }
}
@media (max-width: 420px) {
  .lp-nav { padding: 14px 16px; }
  .lp-nav .lp-btn { padding: 0 14px; font-size: 14px; }
  .lp-hero, .lp-problem, .lp-day, .lp-sp, .lp-foot { padding-left: 16px; padding-right: 16px; }
  .lp-hero-visual { padding: 14px 8px 20px 8px; }
  .lp-chip { font-size: 12.5px; padding: 7px 11px; }
  .lp-cta__google { min-width: 0; width: 100%; }
  .lp-cta__buttons .lp-btn { width: 100%; }
}
```

- [ ] **Step 3: Delete the old landing page**

Run: `git rm src/app/page.tsx`

- [ ] **Step 4: Verify**

1. Run `npx tsc --noEmit`. Expected: no errors.
2. `/` renders, scrolling top to bottom, with:
   - The nav (Log in, Get started).
   - The hero with no buttons and the study card with three chips.
   - "Five apps…" with four ✕ chips.
   - The CTA block with both buttons and the reassurance line.
   - The day arc with four moments.
   - The StudyPulse section with four claims and a GWA of **1.47**.
   - The footer.
3. At 390 px: single column, the arc becomes a vertical dashed timeline, no horizontal scroll.
4. Signed-in users visiting `/` are redirected to `/dashboard` (middleware).
5. Check every visible claim against spec §5.3.

- [ ] **Step 5: Commit**

```bash
git status --short
git add "src/app/(public)/page.tsx" "src/app/(public)/public.css" src/components/public/landing
git commit -m "Rebuild landing page: the page is a day, StudyPulse-led, truthful sample cards

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Motion (use the `animate` skill, then the `emil-design-eng` skill)

**Files:**
- Create: `src/components/public/landing/LandingMotion.tsx`
- Modify: `src/app/(public)/page.tsx` (mount `LandingMotion`), `src/app/(public)/public.css` (append the motion section)

**Interfaces:**
- Consumes the Task 10 hooks: `[data-reveal]`, `[data-countup]`, `.lp-bars i`, `.lp-chip--float`, `[data-xchips]`, `[data-arc]`, `.lp-arc__sun`. Also `.auth-glow` from Task 7.
- Produces: nothing for other tasks.

- [ ] **Step 1: Invoke `animate` for each motion in spec §8 before writing code.** Follow its order: purpose → property → curve → interruption → reduced motion. If a value below conflicts with its guidance, keep the spec value and note the reason in the commit message.

- [ ] **Step 2: Append the motion CSS to `public.css`**

```css
/* ── Motion (spec §8). transform/opacity only; all of it is removed under reduced motion. ── */
@keyframes pub-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes pub-pop { from { opacity: 0; transform: scale(.98); } to { opacity: 1; transform: none; } }
@keyframes pub-grow { from { transform: scaleY(0); } to { transform: none; } }
@keyframes pub-chip-in { from { opacity: 0; transform: translateY(8px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes pub-drift { from { transform: translateY(-4px); } to { transform: translateY(4px); } }
@keyframes pub-glow-drift { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(24px, -16px, 0); } }

@media (prefers-reduced-motion: no-preference) {
  .lp [data-reveal] { animation: pub-rise .5s var(--pub-ease) both; }
  .lp .lp-hero__copy [data-reveal]:nth-child(2) { animation-delay: 60ms; }
  .lp .lp-hero__copy [data-reveal]:nth-child(3) { animation-delay: 120ms; }
  .lp [data-reveal="card"] { animation: pub-pop .55s var(--pub-ease) 140ms both; }
  .lp .lp-bars i { animation: pub-grow .6s var(--pub-ease) both; }
  .lp .lp-bars div:nth-child(1) i { animation-delay: 260ms; } .lp .lp-bars div:nth-child(2) i { animation-delay: 300ms; }
  .lp .lp-bars div:nth-child(3) i { animation-delay: 340ms; } .lp .lp-bars div:nth-child(4) i { animation-delay: 380ms; }
  .lp .lp-bars div:nth-child(5) i { animation-delay: 420ms; }
  .lp .lp-chip--float { animation: pub-chip-in .45s var(--pub-ease) both, pub-drift 7s ease-in-out infinite alternate; }
  .lp .lp-hero-visual .lp-chip--float:nth-of-type(1) { animation-delay: 560ms, 1s; }
  .lp .lp-hero-visual .lp-chip--float:nth-of-type(2) { animation-delay: 640ms, 1.6s; animation-duration: .45s, 8s; }
  .lp .lp-hero-visual .lp-chip--float:nth-of-type(3) { animation-delay: 720ms, 2.2s; animation-duration: .45s, 6s; }
  .lp-xchips .lp-x { transition: transform .6s var(--pub-ease), opacity .6s var(--pub-ease); }
  .lp-xchips.is-in .lp-x { opacity: .6; }
  .lp-xchips.is-in .lp-x:nth-child(odd) { transform: translateX(12px); }
  .lp-xchips.is-in .lp-x:nth-child(even) { transform: translateX(-12px); }
  .lp-moment { transition: opacity .5s var(--pub-ease), transform .5s var(--pub-ease); }
  .lp-arc:not(.is-lit-1) .lp-moment:nth-child(1), .lp-arc:not(.is-lit-2) .lp-moment:nth-child(2),
  .lp-arc:not(.is-lit-3) .lp-moment:nth-child(3), .lp-arc:not(.is-lit-4) .lp-moment:nth-child(4) { opacity: .45; transform: translateY(6px); }
  .lp-arc__sun { opacity: 1; offset-path: path('M0,180 C90,20 310,20 400,180'); offset-rotate: 0deg; offset-distance: var(--sun, 0%); transition: offset-distance .2s linear; }
  .auth-glow--a, .auth-glow--b { animation: pub-glow-drift 30s ease-in-out infinite alternate; }
  html.pub-hidden .auth-glow--a, html.pub-hidden .auth-glow--b, html.pub-hidden .lp-chip--float { animation-play-state: paused; }
  .auth-card { animation: pub-pop .35s var(--pub-ease) both; }
  .auth-hint.is-error { animation: pub-rise .2s var(--pub-ease) both; }
}
```

The sun's `offset-path` is in SVG viewBox units, but the arc box is responsive. `LandingMotion` therefore scales the path to the box: it sets `--sun-path` with the box's real width and height, and the CSS uses `offset-path: var(--sun-path)` when that's set. Add this line under the `.lp-arc__sun` rule inside the media query:

```css
  .lp-arc[style*="--sun-path"] .lp-arc__sun { offset-path: var(--sun-path); }
```

- [ ] **Step 3: `LandingMotion.tsx`**

```tsx
'use client';
import { useEffect } from 'react';

/* Small, dependency-free motion driver for the landing page (spec §8):
   - count-up for [data-countup] (once, 700 ms)
   - ✕ chips nudge toward the centre when they scroll into view (once)
   - the day arc: the sun follows scroll progress through the section; moments light up in order
   - pauses decorative loops while the tab is hidden
   Does nothing under prefers-reduced-motion (CSS already shows the final state). */
export default function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cleanups: (() => void)[] = [];

    document.querySelectorAll<HTMLElement>('[data-countup]').forEach(el => {
      const target = Number(el.dataset.countup);
      const decimals = (el.dataset.countup!.split('.')[1] ?? '').length;
      const start = performance.now();
      let raf = 0;
      const step = (t: number) => {
        const p = Math.min(1, (t - start) / 700);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (target * eased).toFixed(decimals);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      el.textContent = (0).toFixed(decimals);
      raf = requestAnimationFrame(step);
      cleanups.push(() => cancelAnimationFrame(raf));
    });

    const x = document.querySelector('[data-xchips]');
    if (x) {
      const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { x.classList.add('is-in'); io.disconnect(); } }, { threshold: 0.6 });
      io.observe(x);
      cleanups.push(() => io.disconnect());
    }

    const arc = document.querySelector<HTMLElement>('[data-arc]');
    if (arc) {
      const sizePath = () => {
        const w = arc.clientWidth, h = arc.clientHeight;
        const sx = w / 400, sy = h / 200;
        arc.style.setProperty('--sun-path', `path('M0,${180 * sy} C${90 * sx},${20 * sy} ${310 * sx},${20 * sy} ${w},${180 * sy}')`);
      };
      let ticking = false;
      const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          const r = arc.getBoundingClientRect();
          const vh = window.innerHeight;
          const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
          arc.style.setProperty('--sun', `${(p * 100).toFixed(1)}%`);
          [0.12, 0.38, 0.62, 0.88].forEach((at, i) => arc.classList.toggle(`is-lit-${i + 1}`, p >= at));
        });
      };
      sizePath(); onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', sizePath);
      cleanups.push(() => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', sizePath); });
    }

    const vis = () => document.documentElement.classList.toggle('pub-hidden', document.hidden);
    document.addEventListener('visibilitychange', vis);
    cleanups.push(() => document.removeEventListener('visibilitychange', vis));

    return () => cleanups.forEach(f => f());
  }, []);
  return null;
}
```

In `src/app/(public)/page.tsx`, import `LandingMotion` and render `<LandingMotion />` as the last child of `.pub-root`.

Auth pages pause their glows when the tab is hidden through the same `pub-hidden` class. Add the identical visibility effect (the four lines starting at `const vis`, wrapped in `useEffect`) to `DaypartGreeting.tsx`, inside its existing `useEffect` setup and cleanup.

- [ ] **Step 4: Invoke `emil-design-eng` and review the result in the browser.** Check:
- Press scale on every button.
- The focus ring on fields.
- The error text sliding in.
- The "✓ Logged in" 400 ms beat.
- Chip drift is subtle (±4 px) and never jittery.

Fix anything it flags in `public.css` only.

- [ ] **Step 5: Verify**

1. Reload `/`:
   - Text rises with a stagger.
   - The card pops in and the GWA counts up 0.00 → 1.42.
   - The bars grow and the chips arrive one by one, then drift.
2. Scroll: the ✕ chips nudge once. In the day section the sun travels the arc, and the moments light up in order.
3. In DevTools, set Rendering → `prefers-reduced-motion: reduce` and reload. Nothing moves, every final state is visible, and the GWA reads 1.42.
4. Switch tabs: the CPU drops (the Performance panel shows no animation frames while hidden).

- [ ] **Step 6: Commit**

```bash
git status --short
git add "src/app/(public)/public.css" "src/app/(public)/page.tsx" src/components/public/landing/LandingMotion.tsx src/components/public/auth/DaypartGreeting.tsx
git commit -m "Add landing and auth motion with reduced-motion fallbacks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Privacy and Terms drafts, verification banner, year prefill, README

**Files:**
- Create: `src/app/(public)/privacy/page.tsx`, `src/app/(public)/terms/page.tsx`, `src/components/public/LegalPage.tsx`, `src/components/dashboard/VerifyEmailBanner.tsx`
- Modify: `src/app/dashboard/page.tsx`, `src/app/studypulse/subjects/page.tsx`, `src/components/studypulse/SubjectsGrid.tsx`, `README.md`, `src/app/(public)/public.css` (append the legal styles)

**Interfaces:**
- Consumes: `findById` (Task 4), `/api/auth/verify/resend` (Task 6), `YEAR_LEVELS` from `src/components/studypulse/subjects/SubjectForm.tsx`.
- Produces: `SubjectsGrid` gains the prop `defaultYear?: string | null`.

- [ ] **Step 1: The `LegalPage` shell and the two drafts**

`src/components/public/LegalPage.tsx`:

```tsx
import Link from 'next/link';

export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="pub-root lp lp-legal">
      <header className="lp-nav"><Link href="/" className="pub-logo" aria-label="VibeBoard home"><b>Vibe</b><i>Board</i></Link></header>
      <main className="lp-legal__body">
        <h1 className="lp-h2">{title}</h1>
        <p className="lp-mute">Last updated {updated}</p>
        {children}
      </main>
    </div>
  );
}
```

Append to `public.css`:

```css
.lp-legal__body { max-width: 720px; margin: 0 auto; padding: 24px 24px 72px; font-size: 16px; line-height: 1.65; }
.lp-legal__body h2 { font-size: 20px; letter-spacing: -.02em; margin: 32px 0 8px; }
.lp-legal__body ul { padding-left: 20px; }
```

`src/app/(public)/privacy/page.tsx`. The comment at the top is mandatory and stays until the owner approves:

```tsx
// DRAFT (spec §9): the owner must review and approve this wording before any public deployment.
import type { Metadata } from 'next';
import LegalPage from '@/components/public/LegalPage';

export const metadata: Metadata = { title: 'Privacy · VibeBoard' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 23, 2026">
      <p>VibeBoard is a student project. We keep only what the app needs to work, and we never sell your data.</p>
      <h2>What we store</h2>
      <ul>
        <li>Your name and email address.</li>
        <li>If you sign in with Google: your Google account ID and, if you choose to give it, your year level. We don&apos;t get your Google password.</li>
        <li>If you use a password: a one-way hash of it, never the password itself.</li>
        <li>What you add to the app: subjects, grades, tasks, schedules, money entries and habits.</li>
        <li>If you connect Canvas: an access token, stored encrypted, and the course items it syncs.</li>
      </ul>
      <h2>Why</h2>
      <p>To show your board, keep you signed in, let you reset your password, and sync Canvas if you ask us to.</p>
      <h2>Emails</h2>
      <p>We only email you to confirm your address or reset your password.</p>
      <h2>Deleting your data</h2>
      <p>Ask us to delete your account and we will remove it along with everything linked to it.</p>
    </LegalPage>
  );
}
```

`src/app/(public)/terms/page.tsx`:

```tsx
// DRAFT (spec §9): the owner must review and approve this wording before any public deployment.
import type { Metadata } from 'next';
import LegalPage from '@/components/public/LegalPage';

export const metadata: Metadata = { title: 'Terms · VibeBoard' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="October 23, 2026">
      <p>VibeBoard is a free student productivity app, provided as is.</p>
      <h2>Your account</h2>
      <p>Keep your login to yourself. You&apos;re responsible for what happens under your account.</p>
      <h2>Your data</h2>
      <p>What you add stays yours. Grade projections and calculations are estimates to help you plan. Always check official grades with your school.</p>
      <h2>Fair use</h2>
      <p>Don&apos;t try to break, overload or access other people&apos;s accounts.</p>
      <h2>Changes</h2>
      <p>We may update the app and these terms. If something important changes, we&apos;ll say so in the app.</p>
    </LegalPage>
  );
}
```

- [ ] **Step 2: Verification banner**

`src/components/dashboard/VerifyEmailBanner.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';

/* Spec §7.4: shown only to accounts whose email isn't confirmed yet. Dismiss lasts for the browser session. */
export default function VerifyEmailBanner() {
  const [hidden, setHidden] = useState(true);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'cooldown'>('idle');
  useEffect(() => { try { setHidden(sessionStorage.getItem('vb-verify-dismissed') === '1'); } catch { setHidden(false); } }, []);
  if (hidden) return null;

  async function resend() {
    setState('sending');
    const r = await fetch('/api/auth/verify/resend', { method: 'POST' });
    setState(r.status === 429 ? 'cooldown' : 'sent');
  }
  return (
    <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, justifyContent: 'space-between',
      background: 'rgba(255,255,255,.85)', border: '1px solid rgba(31,27,43,.08)', borderRadius: 14, padding: '12px 16px',
      margin: '0 0 20px', fontSize: 15, color: '#1f1b2b' }}>
      <span>
        {state === 'sent' ? 'Sent! Check your inbox for the confirmation link.'
          : state === 'cooldown' ? 'We just sent one. Give it a minute before trying again.'
          : 'Confirm your email so you can always reset your password.'}
      </span>
      <span style={{ display: 'flex', gap: 14 }}>
        {state === 'idle' && <button type="button" onClick={resend} style={{ background: 'none', border: 0, color: '#d9628c', fontWeight: 700, cursor: 'pointer', fontSize: 15, minHeight: 44 }}>Resend</button>}
        <button type="button" onClick={() => { try { sessionStorage.setItem('vb-verify-dismissed', '1'); } catch { /* storage blocked */ } setHidden(true); }}
          style={{ background: 'none', border: 0, color: '#6b6478', cursor: 'pointer', fontSize: 15, minHeight: 44 }}>Dismiss</button>
      </span>
    </div>
  );
}
```

In `src/app/dashboard/page.tsx`:
1. Add the imports `import { findById } from '@/lib/auth/users';` and `import VerifyEmailBanner from '@/components/dashboard/VerifyEmailBanner';`.
2. After `const firstName = …`, add `const me = await findById(Number(session.user.id));`.
3. Render `{me && !me.email_verified_at && <VerifyEmailBanner />}` as the first child inside the outer `<div className="vb-bg …">`, before the header row.

- [ ] **Step 3: Year prefill**

`src/app/studypulse/subjects/page.tsx`: add `import { findById } from '@/lib/auth/users';`. Replace the `return` line with:

```tsx
  const me = await findById(parseInt(session.user.id));
  return <SubjectsGrid initialSubjects={subjects} defaultYear={me?.year_level ?? null} />;
```

In `src/components/studypulse/SubjectsGrid.tsx`:
1. Change the import to `import SubjectForm, { BLANK_FORM, YEAR_LEVELS, type SubjectFormValues } from './subjects/SubjectForm';`.
2. Change the signature to `export default function SubjectsGrid({ initialSubjects, defaultYear = null }: { initialSubjects: SubjectCardData[]; defaultYear?: string | null }) {`.
3. Directly after it, add:

```tsx
  // Spec §7.5: pre-fill the year chosen at sign-up (subjects only allow 1st–4th Year).
  const blank = useMemo<SubjectFormValues>(
    () => ({ ...BLANK_FORM, year_level: defaultYear && YEAR_LEVELS.includes(defaultYear) ? defaultYear : '' }),
    [defaultYear],
  );
```

4. Replace the three uses of `BLANK_FORM` in this file (the `useState` initial value, `closeForm` and `openForCreate`) with `blank`. Add `blank` to `closeForm`'s `useCallback` dependency array: `}, [blank]);`.

- [ ] **Step 4: README**

Add this section to `README.md` after the environment setup section:

```markdown
## Google sign-in and email setup

1. **Google OAuth client** ([console](https://console.cloud.google.com/apis/credentials)):
   - Authorized JavaScript origins: `http://localhost:3000` (and your production URL later).
   - Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`.
   - Put the client ID in both `GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
   - The OAuth consent screen needs a privacy policy URL (`/privacy`) before publishing beyond "Testing".
2. **Email** (password reset and verification) is sent from a Gmail account with an App Password:
   - Turn on 2-Step Verification for that account.
   - Create an App Password at https://myaccount.google.com/apppasswords.
   - Set `GMAIL_USER` and `GMAIL_APP_PASSWORD`.
   - With these unset in development, emails (including reset links) are printed to the dev-server console.
3. The `/privacy` and `/terms` pages are drafts. Review them before deploying.
```

- [ ] **Step 5: Verify**

1. Run `npx tsc --noEmit`. Expected: no errors.
2. `/privacy` and `/terms` render on the pastel background, and the footer links work.
3. Logged in as `qa+auth2@example.com` (unverified, unless you verified it in Task 9; set `email_verified_at=NULL` to test):
   - The banner shows on `/dashboard`. **Resend** shows "Sent!" and the console prints a verification mail. **Dismiss** hides it until the browser session ends.
   - Existing (verified) accounts never see it.
4. As the Google user created in Task 9 with year **2nd**: `/studypulse/subjects` → **Add subject** shows Year level preselected as **2nd**.

- [ ] **Step 6: Commit**

```bash
git status --short
git add "src/app/(public)/privacy/page.tsx" "src/app/(public)/terms/page.tsx" "src/app/(public)/public.css" src/components/public/LegalPage.tsx src/components/dashboard/VerifyEmailBanner.tsx src/app/dashboard/page.tsx src/app/studypulse/subjects/page.tsx src/components/studypulse/SubjectsGrid.tsx README.md
git commit -m "Add draft Privacy/Terms, email verification banner, sign-up year prefill, setup docs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: QA pass (`mobile-native`, `ui-ux-pro-max`, `break-ui`, `review-animations`, `impeccable`)

**Files:** fixes only, in the files created by Tasks 7–12. A QA record goes to `docs/superpowers/plans/2026-10-23-public-pages-auth-revamp-qa.md`.

- [ ] **Step 1: Screenshot matrix.** With the Playwright MCP and the dev server running, capture each URL below at 390×844, 768×1024 and 1440×900:
  - `/`
  - `/login?daypart=morning|afternoon|evening|night`
  - `/signup` (plus `?daypart=night`)
  - `/signup/finish` (needs a live ticket from Google)
  - `/forgot-password` (both states)
  - `/reset-password?token=bad`
  - `/verify-email?token=bad`
  - `/privacy`

  Save the images to `.playwright-mcp/auth-revamp/`. Compare each against its mockup (`landing-f1-v6.html`, `auth-login-v4.html`, `auth-signup-reset-v5.html`) and list the differences in the QA file.
- [ ] **Step 2: `mobile-native`.** Check:
  - 16px inputs (no zoom).
  - `100dvh` shells.
  - Safe-area padding.
  - No sticky hover on touch.
  - Tap highlight off.
  - The Google button and every target ≥ 44px.
- [ ] **Step 3: `ui-ux-pro-max` (form UX and accessibility).** Check:
  - Labels, `aria-describedby`, `role="alert"`, focus moving to the first invalid field.
  - Contrast ≥ 4.5:1 for body text on all four skies plus the night card; gradient text only at ≥ 24px.
  - Keyboard-only run through login → forgot → reset, and through finish (arrow keys in `YearPicker`).
- [ ] **Step 4: `break-ui`.** Feed the forms and the finish identity card:
  - A 60-character name.
  - `a.very.long.unbreakable.address.with.many.parts@subdomain.school.edu.ph`.
  - `María`, `李`, `Juan😀` (must be rejected with the name message).
  - An empty optional year.
  - A Google profile with no family name (the last-name field is empty and gets validated).

  Fix any overflow (`overflow-wrap: anywhere` exists on `.auth-ident .who b`; add it wherever else it's needed).
- [ ] **Step 5: `review-animations`.** Check every §8 motion for purpose, curve, duration and interruption, and confirm the reduced-motion fallback.
- [ ] **Step 6: `impeccable` (audit mode)** on `/`, `/login` and `/signup`. Fix P0 and P1 findings, and record P2 findings in the QA file.
- [ ] **Step 7: Honesty re-check.** Tick each row of spec §5.3 against the shipped landing page in the QA file.
- [ ] **Step 8: Clean up the QA data**

```bash
/c/xampp/mysql/bin/mysql.exe -u root vibeboard -e "DELETE FROM user_login WHERE email LIKE 'qa+auth%@example.com'; SELECT COUNT(*) FROM auth_tokens t LEFT JOIN user_login u USING(user_id) WHERE u.user_id IS NULL;"
```
Expected: the orphan count is 0 (the foreign key cascades).

- [ ] **Step 9: Commit**

```bash
git status --short
git add docs/superpowers/plans/2026-10-23-public-pages-auth-revamp-qa.md "src/app/(public)" src/components/public
git commit -m "QA pass for public pages and auth: mobile, accessibility, worst-case data, motion

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Security review and final verification

- [ ] **Step 1:** Run the `security-review` skill on the diff from `6a4b31d` to `HEAD`. It must at least confirm:
  - Nothing trusts identity from a URL or body.
  - The ticket is httpOnly, encrypted and expiring.
  - Tokens are stored hashed and single-use.
  - Forgot-password responses can't be used to discover accounts.
  - Email HTML is escaped.
  - bcrypt cost is 12 and the dummy-hash timing equaliser is in place.
  - The GIS `aud`/`iss` checks exist.
  - `session_version` revocation works.
  - There's no open redirect: every `redirect`/`push` target is a fixed internal path.

  Fix any finding and commit it as `Fix <finding>` with the co-author line.
- [ ] **Step 2:** Run each command and check the output:
  - `node scripts/auth-test.mjs`: all pass.
  - `node scripts/sp-test.mjs`: still all pass.
  - `npx tsc --noEmit`: no errors.
  - `npm run lint`: no new errors in changed files.
  - `npm run build`: succeeds, and the route list shows `/`, `/login`, `/signup`, `/signup/finish`, `/forgot-password`, `/reset-password`, `/verify-email`, `/privacy` and `/terms`.
- [ ] **Step 3:** Use `superpowers:requesting-code-review` for a whole-branch review from `6a4b31d` to `HEAD` against the spec. Fix Critical and Important findings.
- [ ] **Step 4:** Use `superpowers:verification-before-completion`, then report to the user with evidence:
  - Test counts, and the build route list.
  - Screenshots from Task 13.
  - The QA file path.
  - Anything still open: the Privacy and Terms owner review, the Google JavaScript origin, and the Gmail App Password.
