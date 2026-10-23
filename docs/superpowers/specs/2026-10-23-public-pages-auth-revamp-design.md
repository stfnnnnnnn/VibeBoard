# Public pages and auth revamp: landing, login, sign-up, Google onboarding, password reset

**Date:** 2026-10-23
**Status:** Approved in brainstorming. Awaiting written-spec review.
**Mockups (source of truth):** in `.superpowers/brainstorm/1978-1792735932/content/`:
- `landing-f1-v6.html`: landing page.
- `auth-login-v4.html`: login, all four dayparts.
- `auth-signup-reset-v5.html`: create account, finish setting up, password reset.

Earlier files in that folder are history.

**Scope:** `/`, `/login`, `/signup`, a new `/signup/finish`, `/forgot-password`, `/reset-password`, `/verify-email`, `/privacy` and `/terms`. Plus the auth backend: `src/auth.ts`, `src/auth.config.ts`, `/api/auth/*`, the `user_login` schema and email sending. The main dashboard, Habit Tracker and the StudyPulse dashboard are being redesigned separately and are **out of scope**, apart from one small email-verification banner (§7.4) and one prefill (§7.5).

## 1. Why

The user wants the public pages "better by a notch" and the Google flow fixed. Problems found and confirmed against the local DB:

| # | Problem | Evidence |
|---|---|---|
| P1 | **Sign-up fails when middle name is left blank.** The API inserts `NULL` into `middle_name`, which is `NOT NULL`. That's MySQL error 1048 in every SQL mode. | `api/auth/signup/route.ts`, `schema.sql:889` |
| P2 | **14 of the 20 programs fail** with "Program not found in database". The `programs` table has 6 rows. | `SELECT * FROM programs` |
| P3 | **"5th Year" and "6th Year" are offered**, but `year_level` is an enum of 1st to 4th Year. They're silently stored as `''` in the current SQL mode. | `schema.sql:893` |
| P4 | **Account squatting:** `/signup?google=1&email=…` plus `google: true` in the request body. Anyone can create a password-less account for any email with a single POST. | `signup/page.tsx`, `signup/route.ts` |
| P5 | Google-only users get a random bcrypt password. There's no `google_sub`, so accounts are only ever matched by email. | `signup/route.ts` |
| P6 | **Pre-hijack:** an attacker can register a victim's email with a password, and the victim later "logs in with Google" into an account the attacker controls. | auth flow |
| P7 | No password reset, even though `reset_token` columns exist. | grep |
| P8 | Login shows the same message for a wrong password and for a lockout. | `login/page.tsx` |
| P9 | Email sign-up redirects to `/login` after 3 seconds instead of signing the user in. | `signup/page.tsx` |
| P10 | `/workboard` is missing from `PROTECTED`. | `auth.config.ts:3` |
| P11 | Landing: sign-up and log-in are hidden behind a ☰ toggle, `100vh` plus `overflow:hidden`, Segoe UI, hover effects driven by JS `onMouseEnter`, and it isn't responsive. | `app/page.tsx` |
| P12 | Collected but **never read anywhere**: date of birth, program, specialization, status. Sensitive (date of birth) and high-friction. | grep of `src/` |

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Sign-up collects only name, email and password.** Date of birth, middle name, program, specialization and status are removed (data minimisation, PH Data Privacy Act proportionality). The existing columns stay nullable and existing data is kept. |
| D2 | Continue with Google for an unknown email **still leads to a details page** (`/signup/finish`): Google's verified email (locked), an editable name, and one optional question, "What year are you in?" (1st, 2nd, 3rd, 4th, 5th+). |
| D3 | Visual direction: **evolve the pastel brand.** Warm off-white and pastel peach, pink, blue and lavender. No glass behind text. DM Sans. One dark primary button. |
| D4 | Landing = **F1 v6, "the page is a day".** Hero (no buttons) → "Five apps for one semester" → **"Make this your calmest semester"** (the *only* sign-up CTA block) → day arc → StudyPulse up close → footer. The nav holds only the logo, **Log in** and **Get started**. No Canvas pill in the hero. |
| D5 | **Product visuals are stylised capability cards, not screenshots.** Every card maps to a real feature (§5.3) and carries a "Sample data" tag. There are no invented metrics, testimonials or user counts. |
| D6 | Login = **the time-of-day sky (C1) in C3's pastels**, with four dayparts. At night it switches to a dark theme. The card is solid white with clearly defined fields. |
| D7 | Returning users get **Google's own personalized "Continue as …" button** (Google Identity Services). Nothing is stored on the device. "Use another account" is always visible. |
| D8 | **Build password reset.** Emails are sent from a **Gmail account using an App Password** via `nodemailer`, because there's no domain yet. It can be swapped for Resend later behind one module. |
| D9 | **Google is the primary path.** Email and password stay as the secondary option. |
| D10 | Sign out other devices on password reset through a **`session_version`** check. |
| D11 | Email sign-ups get a **non-blocking verification link**. A Google sign-in that matches an *unverified* password account clears that password (fixes P6). |
| D12 | New Google users use a **sign-up ticket** (approach A): an encrypted, httpOnly, 15-minute cookie, so no account row exists until "Open my board". |

## 3. Architecture

### 3.1 Route group and files

The public pages move into a route group so they share one stylesheet and the daypart script. URLs don't change.

```
src/app/(public)/layout.tsx          imports public.css; inline daypart <script> (§6.1)
src/app/(public)/public.css          --pub-* tokens, sky backgrounds, field/button classes
src/app/(public)/page.tsx            landing (server component)
src/app/(public)/login/page.tsx
src/app/(public)/signup/page.tsx
src/app/(public)/signup/finish/page.tsx      server: reads ticket, renders FinishForm
src/app/(public)/forgot-password/page.tsx
src/app/(public)/reset-password/page.tsx     server: validates token, renders form or expired state
src/app/(public)/verify-email/page.tsx       server: consumes token, renders result
src/app/(public)/privacy/page.tsx, terms/page.tsx   static drafts (§9)
```

`src/app/page.tsx`, `login/page.tsx` and `signup/page.tsx` are deleted (they're replaced above).

### 3.2 Components (`src/components/public/`)

| Unit | Responsibility |
|---|---|
| `landing/LandingNav.tsx` | Logo, Log in, Get started. |
| `landing/Hero.tsx` + `HeroStudyCard.tsx` | Tagline, headline, lede, and the study card with three floating chips. |
| `landing/ProblemCta.tsx` | "Five apps…" ✕ chips and the "Make this your calmest semester" CTA block. |
| `landing/DayArc.tsx` | The SVG arc, four moments and the scroll-driven sun dot. |
| `landing/StudyPulseSection.tsx` | Four true claims and the GWA calculator card. |
| `landing/LandingFooter.tsx` | © line, Privacy, Terms. |
| `auth/AuthShell.tsx` | Sky background for the current daypart, top bar (logo plus switch link), centred card. |
| `auth/Field.tsx` | Label, leading icon, input, hint or error with `aria-describedby`, valid/invalid/focus styles. |
| `auth/PasswordField.tsx` | `Field` plus a Show/Hide toggle and an optional strength meter. |
| `auth/GoogleButton.tsx` | The standard "Continue with Google" button (OAuth redirect). |
| `auth/GooglePersonalized.tsx` | Loads GIS, renders the personalized button, falls back to `GoogleButton` (§4.3). |
| `auth/YearPicker.tsx` | Five-option radiogroup. Tapping the selected option again deselects it. |
| `auth/DaypartGreeting.tsx` | Chip ("☀ Thursday · 2:40 PM"), headline and subline for the daypart. |
| `auth/LoginForm.tsx`, `SignupForm.tsx`, `FinishForm.tsx`, `ForgotForm.tsx`, `ResetForm.tsx` | Page forms (client). |

### 3.3 Pure libraries (`src/lib/auth/`, unit-tested)

| Unit | Responsibility |
|---|---|
| `daypart.ts` | `daypartFor(hour)` → `morning` (5–11), `afternoon` (12–16), `evening` (17–20), `night` (21–4), plus the copy for each daypart. |
| `emailTypo.ts` | `suggestEmail(email)` → a corrected address or `null`. Uses a domain list (gmail, yahoo, outlook, hotmail, icloud, edu.ph) with an edit-distance ≤ 2 rule. |
| `passwordStrength.ts` | `scorePassword(pw)` → 0–4 plus a hint. Based on length, character classes and a short common-password list. Minimum 8 characters (enforced server-side too). |
| `validate.ts` | Name (1–100 chars after trimming, letters, spaces, `'-.`), email, password, year-level mapping (`'5th+'` → `'5th Year'`). |
| `tokens.ts` | `newToken()` (32 random bytes, base64url) and `hashToken()` (SHA-256 hex). Uses Node `crypto`. |

### 3.4 Server modules

| Unit | Responsibility |
|---|---|
| `src/lib/auth/users.ts` | DB access: `findByGoogleSub`, `findByEmail`, `createUser`, `linkGoogle`, `bumpSessionVersion`, `getSessionVersion`. |
| `src/lib/auth/ticket.ts` | Encode and decode the sign-up ticket with `next-auth/jwt` `encode`/`decode` (salt `vb-signup-ticket`, `maxAge` 900). Cookie `vb_signup_ticket`: httpOnly, SameSite=Lax, Secure in production, path `/`. |
| `src/lib/auth/authTokens.ts` | Create, consume and cooldown-check rows in `auth_tokens` (§3.5). |
| `src/lib/auth/googleIdToken.ts` | Verify a GIS ID token with `jose` `createRemoteJWKSet('https://www.googleapis.com/oauth2/v3/certs')`. Checks `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}, `aud` = `GOOGLE_CLIENT_ID` and `email_verified` = true. |
| `src/lib/email/mailer.ts` | `sendMail({to, subject, html, text})` through nodemailer Gmail SMTP (`GMAIL_USER`, `GMAIL_APP_PASSWORD`). Without those variables it logs the message and links to the server console, labelled `[mail:dev]`. In production it logs an error and never throws to the caller. |
| `src/lib/email/templates.ts` | `resetEmail`, `googleAccountEmail` ("you sign in with Google") and `verifyEmail`. Each returns `{subject, html, text}` with simple branded HTML. |
| `src/lib/migrate.ts` → `ensureAuthV2Schema()` | Idempotent migration (§3.5), following the file's existing `ensure*` pattern, called from the auth routes. |

### 3.5 Schema (`database/migrations/auth/schema-auth-v2.sql`, mirrored in `ensureAuthV2Schema()` and `database/schema.sql`)

```sql
ALTER TABLE user_login
  MODIFY middle_name  VARCHAR(100) NULL,
  MODIFY year_level   ENUM('1st Year','2nd Year','3rd Year','4th Year','5th Year') NULL,
  MODIFY status       ENUM('Regular','Irregular') NULL,
  MODIFY program      INT(11) NULL,
  MODIFY password     VARCHAR(255) NULL,
  ADD COLUMN google_sub        VARCHAR(255) NULL,
  ADD COLUMN email_verified_at DATETIME NULL,
  ADD COLUMN session_version   INT NOT NULL DEFAULT 0,
  ADD COLUMN created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD UNIQUE KEY google_sub_unique (google_sub);

-- Existing accounts were created before verification existed; treat them as verified
-- so that linking Google does not wipe their passwords (accepted risk: 6 known users).
UPDATE user_login SET email_verified_at = NOW() WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_id    INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  purpose     ENUM('reset','verify') NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY token_hash_unique (token_hash),
  KEY user_purpose (user_id, purpose, created_at),
  CONSTRAINT auth_tokens_user FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
);
```

The `ensure*` version runs each `ADD COLUMN` separately and ignores `ER_DUP_FIELDNAME` and `ER_DUP_KEYNAME`, as the rest of `migrate.ts` does. The verified backfill runs **only in the same call that adds `email_verified_at`**, never again. `reset_token`, `reset_token_expiry`, `programs` and `specializations` are left untouched; no other code references the first two.

### 3.6 Removed

- `PROGRAM_NAME_MAP`, the `PROGRAMS` and `PROGRAM_SPECS` UI, and the date-of-birth age check.
- The `google: true` body flag.
- Reading Google identity from URL query parameters.
- Random-password hashes for new Google users.

## 4. Auth flows

### 4.1 Providers (`src/auth.ts`)

1. **Google** (OAuth redirect, existing).
2. **`credentials`** (email and password, existing, with updated errors, §4.5).
3. **`google-idtoken`** (Credentials): `{credential}` from GIS, verified by `googleIdToken.ts`.
4. **`google-finish`** (Credentials): `{first_name, last_name, year}`. Identity comes **only** from the ticket cookie.
5. **`password-reset`** (Credentials): `{token, password}`. Performs the reset and signs the user in (§4.6).

### 4.2 Resolving a Google identity (shared by providers 1 and 3)

`resolveGoogle({sub, email, name, picture, email_verified})`:

1. If `email_verified` is false → reject (`google-unverified`).
2. `findByGoogleSub(sub)` → if found, sign in as that user.
3. Otherwise `findByEmail(lower(email))`. If found, link it: set `google_sub = sub`. If `password IS NOT NULL AND email_verified_at IS NULL`, also set `password = NULL` and bump `session_version` (D11). Set `email_verified_at = COALESCE(email_verified_at, NOW())`. Then sign in.
4. Not found → write the ticket cookie `{sub, email, given_name, family_name, picture}` and send the user to `/signup/finish`:
   - **OAuth (provider 1):** the `signIn` callback returns `'/signup/finish'`.
   - **GIS (provider 3):** `authorize` throws a `CredentialsSignin` subclass with `code = 'needs-finish'`, and the client navigates to `/signup/finish`.

Writing the cookie uses `cookies()` from `next/headers` inside the Auth.js route handler. **Implementation must verify this works in next-auth 5.0.0-beta.31 before building on it.** The fallback is a small `/api/auth/signup-ticket` route that the `signIn` callback redirects through, carrying a short-lived signed parameter.

The `jwt` callback stores `token.sub = user_id`, `token.name = first_name`, `token.sv = session_version` and `token.svAt = now`.

### 4.3 Google Identity Services ("Continue as …")

- Load `https://accounts.google.com/gsi/client` with `next/script` (`afterInteractive`) **on `/login` and `/signup` only**.
- `google.accounts.id.initialize({ client_id: NEXT_PUBLIC_GOOGLE_CLIENT_ID, callback, use_fedcm_for_button: true, auto_select: false, itp_support: true })`.
- `renderButton(el, { type:'standard', theme: night ? 'filled_black' : 'outline', shape:'pill', size:'large', text:'continue_with', width })`.
- The callback calls `signIn('google-idtoken', { credential, redirect:false })`, which leads to the dashboard or to `/signup/finish` on `needs-finish`.
- **Fallback:** if the script fails to load within 3 s, or `google` is undefined, render `GoogleButton` (OAuth redirect). The button area has a fixed height so nothing shifts.
- Google's button can't be restyled beyond theme, shape and size. The mockup's custom chip is illustrative only.
- **Setup steps for the user (documented in the README):** add `http://localhost:3000` and the production origin under **Authorized JavaScript origins** for the OAuth client, and add `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (same value as `GOOGLE_CLIENT_ID`).
- `auto_select:false` and no One Tap prompt. A shared lab PC never signs anyone in silently (D7).

### 4.4 `/signup/finish`

- **Server page:** decode the ticket. If it's missing or expired, `redirect('/signup?e=ticket')`. The sign-up page then shows "Your Google sign-in timed out. Please continue with Google again."
- **Renders:** "Nice to meet you, {first name}." The headline updates live as the first-name field changes (falling back to "there" when empty). Then the identity card (picture or initial, email, "✓ Verified by Google", "Not you?"), first and last name prefilled from `given_name` and `family_name`, the optional `YearPicker`, "Open my board →" and the Terms/Privacy line.
- **Submit:** `signIn('google-finish', {first_name, last_name, year, redirect:false})`. `authorize` re-reads the ticket, validates the names, inserts the user (`password NULL`, `google_sub`, `email_verified_at NOW()`, `year_level` or `NULL`), deletes the cookie and returns the user. On success, navigate to `/dashboard`.
- **Race:** a duplicate `google_sub` or email (`ER_DUP_ENTRY`) is resolved through the §4.2 lookup and signs the user in as the existing account.
- **"Not you?" and "Cancel":** `DELETE /api/auth/signup-ticket` clears the cookie, then go to `/login`.

### 4.5 Email sign-up and login

- **Sign-up:** `POST /api/auth/signup` with `{first_name, last_name, email, password}`.
  - Validate with `validate.ts` and hash with bcrypt (cost 12).
  - Insert the row: `email_verified_at` NULL; `middle_name`, `year_level`, `status`, `program`, `specialization` and `dateofbirth` all NULL.
  - Create a `verify` token (24 h) and send the verification email without waiting for it.
  - Respond 201. The client then calls `signIn('credentials')` and goes to `/dashboard` (fixes P9).
  - A duplicate email returns 409 with `{field:'email', code:'taken'}`, shown inline (mockup 1b).
- **Login:** `authorize` throws `CredentialsSignin` subclasses:
  - `code:'invalid'` for an unknown email, a wrong password or a `password IS NULL` account. One message covers all three (no enumeration): "That email and password don't match. Check for typos, or continue with Google if that's how you signed up."
  - `code:'locked:<seconds>'` when `failed_attempts ≥ 5` within 10 minutes. The UI shows "Too many attempts. Try again in N minutes, or continue with Google" with a live countdown.
- The existing 5-attempt, 10-minute lock is kept.

### 4.6 Password reset

- **`POST /api/auth/password/forgot`** with `{email}` **always** responds `200 {ok:true}` after constant work. If the user exists:
  - If `password IS NULL` (Google-only): send `googleAccountEmail` ("You sign in with Google. Use Continue with Google. Want a password too? Use this link.") and still issue a reset token.
  - Cooldown: no new token if one was created for this user and purpose in the last **60 s**.
  - Token: 30-minute expiry. Only the hash is stored. The link is `${AUTH_URL}/reset-password?token=…`.
- **`/reset-password` (server):** looks up the hash. If the token is unused and unexpired → `ResetForm` (shows the email). Otherwise → "This link has expired or was already used" with **Send a new link** (prefilled email → `/forgot-password`).
- **Submit:** `signIn('password-reset', {token, password, redirect:false})`. `authorize`, in one transaction:
  - Re-validates the token and checks password strength (≥ 8).
  - Updates the hash, sets `used_at` and expires the user's other unused reset tokens.
  - Sets `failed_attempts = 0` and `last_attempt = NULL`.
  - Bumps `session_version` and sets `email_verified_at = COALESCE(…, NOW())`.
  - Returns the user, then navigate to `/dashboard`.

### 4.7 Email verification

- The link `/verify-email?token=…` consumes a `verify` token, sets `email_verified_at` and shows "Email confirmed ✓" with an "Open my board" link. Expired or used links show **Resend** if the visitor is signed in.
- `POST /api/auth/verify/resend` (signed-in users, 60 s cooldown).

### 4.8 Session version (D10)

In the `jwt` callback (Node runtime, so it runs wherever `auth()` from `@/auth` is used):
- If `Date.now() - token.svAt > 5 min`, re-read `session_version`.
- If it differs, or the user no longer exists, return `null`, which ends the session.
- Otherwise update `svAt`.

The middleware (`auth.config.ts`) stays edge-safe and does no DB access, so a revoked session lasts at most about 5 minutes on pages that don't call `auth()`.

### 4.9 Route config (`auth.config.ts`)

- `PROTECTED` gains `/workboard` (P10).
- `AUTH_PAGES` (signed-in users are redirected to `/dashboard`): `/`, `/login`, `/signup`, `/signup/finish`, `/forgot-password`.
- `/reset-password`, `/verify-email`, `/privacy` and `/terms` are always reachable.

## 5. Landing page (mockup `landing-f1-v6.html`)

### 5.1 Structure

1. **Nav:** logo; on the right, **Log in** (white pill) and **Get started** (dark pill, linking to `/signup`). No section links.
2. **Hero:**
   - Left side: the tagline "Plan it. **Track it.** Ace it." (Track it in pink), then the H1 "Ace the semester. *Keep the rest in check.*" (second line in a pink-to-blue gradient), then the lede. **No buttons.**
   - Right side: `HeroStudyCard`, with the chips "Quiz 4 · Fri", "₱420 safe to spend" and "Reading · day 12".
3. **Problem → CTA:** "Sound familiar? Five apps for one semester." with four ✕ chips, then the CTA block "Make this your *calmest semester.*"
   - Subline: "One board for grades, deadlines, money and habits."
   - Buttons: **Create free account** (dark) and **Continue with Google**.
   - Below them: "✓ Free for students · ✓ Sign up in under a minute".
4. **Day arc:** "A day with VibeBoard · Every part of your day, *a few seconds each.*" Four moments: 7:30 AM Study, 12:10 PM Money, 4:00 PM Work, 10:00 PM Habits.
5. **StudyPulse up close:** "Know your grade *before finals do.*", four ✓ claims and the GWA calculator card.
6. **Footer:** "© 2026 VibeBoard · Made by students, for students", Privacy, Terms.

### 5.2 Background

The page is one tall element with a fixed gradient along its length:

`#fff6f1 → #fdeef4 (16%) → #f6f2fb (36%) → #eaf5fc (58%) → #eef0fb (80%) → #ece8f6`

Scrolling therefore moves from morning to dusk with **no JavaScript**. Two radial glows (peach and pink) sit behind the hero. There are no section borders and no `100vh` lock.

### 5.3 Honesty table (every visual must stay true; re-check during review)

| Visual | Real source |
|---|---|
| "1.42 · Midterm GWA estimate" | `stats.midtermGPA` (`api/studypulse/stats/route.ts:378`) |
| Bars per subject | Each subject's current grade on the subjects page |
| "Calc 2 · need on what's left 78% · Achievable" | `projection.ts` `need` and `status` (`PeriodPlanCard.tsx:123`) |
| "Quiz 4 · Fri" / "Already on your board" | Canvas sync or manual entries |
| "₱420 safe to spend" | Finance safe-to-spend (`api/finance/safe-to-spend`) |
| "₱95 lunch logged in seconds" | Finance quick log (`LogComposer`) |
| "Org deck moved to Thursday" | Workboard week picker |
| "Day 12 of your reading streak" | Habits streaks |
| 1.0 / 4.0 scales | `gradeScale.ts` |
| GWA calculator reads a screenshot | `GwaCalculator.tsx` (tesseract OCR) |
| "Pulls deadlines from Canvas, if your school uses it" | `/api/canvas/*` |
| Sample GWA 1.47 | (1.25·3 + 1.50·3 + 1.75·2) / 8 = 1.469 |
| "Free for students" | No billing exists |
| "Sign up in under a minute" | 4 fields, or Google plus 2 |

No ▲ trend, no "On track" at GWA level, no user counts, ratings or testimonials. Cards show a "Sample data" tag.

## 6. Auth visual system (mockups `auth-login-v4.html`, `auth-signup-reset-v5.html`)

### 6.1 Dayparts

- An inline script in `(public)/layout.tsx` sets `document.documentElement.dataset.daypart` from local time **before first paint**, so nothing flashes.
- The server renders `afternoon` as the default (no JavaScript).
- Dev only: a `?daypart=` override is honoured when `NODE_ENV !== 'production'`, for QA screenshots.
- The landing page ignores dayparts. Its background is scroll-based.

| Daypart | Sky | Chip / headline / subline |
|---|---|---|
| morning | `#ffe8dc → #fff1ea → #fdeef4`, peach glow rising bottom-centre | "☀ {Day} · {time}", "Good morning.", "Let's set up the day." |
| afternoon | `#e3f1fb → #eef5fc → #fbeef4`, soft sun top-right, two blurred clouds | "Good afternoon.", "Pick up where you left off." |
| evening | `#ece6fb → #f7e6f1 → #ffe6dc`, peach glow setting bottom-left | "◐ …", "Good evening.", "Time to wrap up the day." |
| night | `#1d1934 → #28224a → #3a2f5e`, pastel stars, crescent moon, pink and blue glows; **dark card** `#221d38` | "☾ …", "Still up?", "Your board's ready. Don't stay too late." |

Sign-up and reset pages use the same sky and the same shell, with copy specific to each page (as in the mockups).

### 6.2 Card and fields

- **Card:** solid `#fff` (night: `#221d38`), radius 20, padding 24 (16 on phones), `max-width: 400px`.
- **Labels:** 13px, bold, above every field.
- **Fields:**
  - Height 44 (phone ≥ 44 for the tap target), 1.5px border `#d9d3e2`, background `#fbfafc`, radius 12, a leading icon (lucide `Mail` / `Lock` / `User`), **16px input text** (prevents iOS zoom).
  - Focus: border `--pub-pink` plus a 3.5px pink ring.
  - Valid after leaving the field: green border tint and ✓.
  - Invalid: red border and an inline error underneath.
- **Buttons:**
  - **One** dark primary button per card (height 44, radius 12).
  - Secondary buttons: outlined.
  - "Forgot password?" sits on the password label row.
  - The switch link ("New here? Sign up" / "Have an account? Log in") is in the top bar.
- **Errors:** inline beside their field. Form-level errors appear in a `role="alert"` box. After a failed submit, focus moves to the first invalid field.

### 6.3 Tokens (`public.css`)

`--pub-ink #1f1b2b`, `--pub-mute #6b6478`, `--pub-soft #8f879c`, `--pub-field #d9d3e2`, `--pub-pink #d9628c`, `--pub-pink-soft #fde3ec`, `--pub-blue #3d8fbf`, `--pub-blue-soft #dcf0fb`, `--pub-lav #8a78c4`, `--pub-green #2f9a64`, `--pub-red #c4485a`, `--pub-amber #a5671a`, plus the night overrides under `[data-daypart="night"]`.

Logo: **Vibe** in `--pub-pink`, **Board** in `--pub-blue` (`#f2a7c0` / `#91cbe6` at night). Gradient text is used only for the large emphasised words.

## 7. Behaviour details

1. **Email typo hint:** shown when the email field loses focus. "Did you mean juan@gmail.com?" as a button that replaces the value.
2. **Password meter:** four segments with a hint ("Strong enough · add a symbol to make it great"). The minimum is 8 characters, enforced on both client and server.
3. **Carry-over:** the email typed on `/login` is passed to `/forgot-password` through `sessionStorage` (wrapped in try/catch), never through the URL.
4. **Verification banner:** shown on `/dashboard` only, when `email_verified_at IS NULL`. "Confirm your email so you can always reset your password. Resend · Dismiss". Dismissing hides it for the browser session.
5. **Year prefill:** in StudyPulse `SubjectForm`, `year_level` defaults to the user's `year_level` when it is 1st to 4th Year (the `subjects.year_level` enum has no 5th). This makes the "We'll pre-fill it" copy on `/signup/finish` true.
6. **Resend cooldown:** the button shows "Resend in 0:42" and is disabled until the countdown ends.

## 8. Motion (`emil-design-eng` and `animate` rules)

- **Default easing:** `cubic-bezier(.23,1,.32,1)`, 200–300 ms. Only `transform` and `opacity` are animated. **All motion is turned off under `prefers-reduced-motion`** (opacity fades of 150 ms or less remain).

| Element | Motion |
|---|---|
| Hero entrance | Text fades up with a 60 ms stagger. The study card fades and scales from 0.98. The GWA counts up once to 1.42 (700 ms, tabular numbers). Bars grow from the bottom with a 40 ms stagger. |
| Hero chips | Enter one by one after the card. Then an idle drift of ±4px on `translateY`, 6–8 s alternating, with different phases. |
| ✕ chips | When they scroll into view, they slide 12px toward the centre and fade to 60% (600 ms, once). |
| Day arc | The sun dot travels along the path through `offset-path`, driven by `animation-timeline: view()` inside `@supports`. The fallback is an IntersectionObserver that lights the moments in order. |
| Sky glows | Very slow drift (30 s) while the page is visible. Paused when `document.hidden`. |
| Buttons | Press state `scale(.97)` over 120 ms. Hover only on `@media (hover:hover)`. |
| Fields | Border and ring transition over 150 ms. Error text slides in 4px. |
| Login success | The button shows a check for 400 ms, then `router.push('/dashboard')`. |
| Daypart | Static. Chosen before first paint, so there's no transition. |

No GSAP or animation library. CSS plus small hooks.

## 9. Privacy and Terms

`/privacy` and `/terms` are static pages that don't exist yet. Google requires a privacy-policy URL before the OAuth app can move beyond testing mode. The content is a plain-language **draft** listing what is stored (name, email, Google account ID, optional year, the data users enter, and the encrypted Canvas token), why, and how to request deletion. **The owner must review and approve the wording before deploying.** The pages are marked as drafts in the plan, and no claims are added beyond what the code does.

## 10. Accessibility

- Every input has a `<label>`. Hints and errors are linked with `aria-describedby`.
- `YearPicker` is a `role="radiogroup"` with arrow-key support.
- Form errors appear in a `role="alert"` box, with focus management after submit.
- Colour contrast meets WCAG AA:
  - `--pub-mute` on the lightest sky is ≥ 4.5:1.
  - Gradient headline text only at ≥ 24px bold (≥ 3:1).
  - The night card is checked separately.
- Visible `:focus-visible` rings on every interactive element.
- The page works at 200% zoom and at 320px wide with no horizontal scroll.
- Decorative SVG and glows are `aria-hidden`.
- Each page has one `<h1>`. The landing page has `<header>`, `<main>` and `<footer>` landmarks.

## 11. Environment

`.env.example` gains:
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID=` (same value as `GOOGLE_CLIENT_ID`).
- `GMAIL_USER=` and `GMAIL_APP_PASSWORD=` (Google App Password; needs 2-step verification on that account).
- `EMAIL_FROM_NAME=VibeBoard`.

The README gets a "Google sign-in and email setup" section: JavaScript origins, consent-screen privacy URL and App Password steps.

New dependency: `nodemailer` (plus `@types/nodemailer`). `jose` is used through the existing next-auth dependency tree. Add it as a direct dependency if it isn't hoisted.

## 12. Verification

1. **Unit tests** (`node:test`, new `scripts/auth-test.mjs` following `sp-test.mjs`) for `daypart`, `emailTypo`, `passwordStrength`, `validate` and `tokens`, written first.
2. `npx tsc --noEmit` and `npm run build` pass.
3. **Live flows against the local DB:**
   - Email sign-up → auto login.
   - Duplicate email → inline error.
   - Wrong password → generic message; 5 failures → lock with countdown.
   - Forgot → console link (`[mail:dev]`) → reset → auto login → `session_version` bumped → a second browser is signed out within 5 minutes (`svAt` shortened in test).
   - Expired or used reset link.
   - Verify link.
   - Google new user → `/signup/finish` → account created with `password NULL` and `google_sub` set.
   - Google existing user (linking).
   - Google on an unverified password account → password cleared.
   - Expired ticket.
   - Forged POST to `/api/auth/signup` with `google:true` → treated as a normal password sign-up (the flag is ignored).
4. **Playwright screenshots** at 390, 768 and 1440 px for every page × 4 dayparts (`?daypart=`), plus reduced-motion.
5. **`break-ui` pass:** a 60-character name, a long unbreakable email, non-Latin names (María, 李), emoji, and an empty optional year.
6. **`security-review` skill** run on the auth diff before commit.
7. **Honesty table (§5.3)** re-checked against the shipped landing page.

## 13. Skill usage (which skill, for what)

| Phase | Skill | Used for |
|---|---|---|
| Design (done) | `superpowers:brainstorming` | This spec and the mockups. |
| Plan | `superpowers:writing-plans` | Task-by-task plan with checkpoints. |
| Build | `superpowers:subagent-driven-development` (Opus subagents) | Executing independent tasks (libs, API, pages). |
| Build | `superpowers:test-driven-development` | The pure `src/lib/auth/*` libs. |
| Build | `vercel:nextjs`, `vercel:react-best-practices` | App Router conventions: route group, server components, `next/script`. |
| Build (UI) | `frontend-design` | Turning the mockups into production layout and type at real sizes. |
| Build (UI) | `ui-ux-pro-max` | Form UX rules, contrast, touch targets, error-message patterns, checked per page. |
| Build (motion) | `animate` | Building each §8 motion (purpose → property → curve → interruption → reduced motion). |
| Polish | `emil-design-eng` | The invisible details: press states, focus rings, the field-to-error transition, timing. |
| Polish | `mobile-native` | iOS zoom (16px inputs), safe areas, `100dvh`, tap highlight, hover-only rules. |
| Review | `review-animations` | Auditing the shipped motion against §8. |
| Review | `break-ui` | Worst-case data stress test (§12.5). |
| Review | `impeccable` (audit mode) | A final design-quality audit of the public pages. |
| Review | `security-review`, `superpowers:requesting-code-review` | The auth diff. |
| Done | `superpowers:verification-before-completion` | Evidence before claiming it's finished. |

**Not used:**
- `gpt-taste` (GSAP and pinned scroll conflict with the no-library, CSS-first motion here).
- `industrial-brutalist-ui` and `minimalist-ui` (they contradict D3's pastel brand).
- `high-end-visual-design` and `design-taste-frontend` (they overlap with `frontend-design`; one aesthetic owner avoids conflicting rules).
- `banner-design`, `slides`, `design` and `brand` (no marketing assets in scope).
- `vercel:auth` (it covers hosted providers such as Clerk; we keep Auth.js plus MySQL).
- `vercel:marketplace` (consulted; Resend was deferred because there's no domain, D8).

## 14. Out of scope

- Redesigns of the main dashboard, Habit Tracker and StudyPulse dashboard.
- An account settings page (changing name, year, email or password while signed in).
- Passkeys and Resend or a custom domain.
- Dropping the `programs` and `specializations` tables or the legacy `reset_token` columns.
- One Tap and automatic sign-in.
