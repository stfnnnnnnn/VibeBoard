# Handoff: deploy VibeBoard to Vercel with a hosted MySQL database

**For:** the coding agent that does this deployment (Google Antigravity), plus the owner (Karl) for the steps that need his accounts.
**Goal:** VibeBoard runs on a public Vercel URL, against a hosted MySQL database holding the current local data. Sign-in, StudyPulse, Workboard, Finance, Habits and Canvas sync must all work.

---

## 1. What you are deploying

- **Repo:** https://github.com/stfnnnnnnn/VibeBoard, branch `main` (the local `master` tracks it).
- **Stack:**
  - Next.js 15 (App Router) and React 19, TypeScript.
  - Auth.js (NextAuth v5): Credentials plus Google sign-in, JWT sessions.
  - `mysql2/promise`. There is no ORM: raw SQL, through one pool in `src/lib/db.ts`.
- **Local dev today:** XAMPP MariaDB 10.4, database `vibeboard`, user `root` with an empty password, `localhost:3306`.
- **Commands:**
  - Build: `npm run build` (`next build`). Start: `next start`.
  - Tests: `node scripts/sp-test.mjs` (104 pass) and `node scripts/wb-test.mjs` (17 pass).
  - Type check: `npx tsc --noEmit` (0 errors).
- **Schema has two layers:**
  1. `database/schema.sql`: the base dump (49 tables, plus triggers on `activities`, `quizzes` and `exams`).
  2. `src/lib/migrate.ts`: idempotent `ensure*Schema()` functions that API routes call at request time. They add columns and tables (`ALTER TABLE … ADD COLUMN`, tolerating `ER_DUP_FIELDNAME`).

  The `database/migrations/*` SQL files are reference copies of what `migrate.ts` already does. Don't run them on a database the app has already touched.

## 2. The decisions, already made

| Topic | Decision | Why |
|---|---|---|
| Database host | **Aiven for MySQL, free plan** (MySQL 8). Fallback: Railway MySQL. | Real MySQL with foreign keys and triggers. |
| Avoid | **TiDB Serverless and PlanetScale** | Both lack triggers, which the schema relies on. The triggers auto-set `status='Done'` on graded `activities`/`quizzes`/`exams`, and Workboard code depends on that behaviour (see `src/lib/workboard/academicWrites.ts`). |
| Region | DB and Vercel functions in **Singapore** (Aiven `aws-ap-southeast-1` or nearest; Vercel `sin1`) | The users are in the Philippines. The pool already uses timezone `+08:00`. |
| Data | **Migrate the owner's current local data**, not a blank database | The owner has real grades, finance and habits data locally. |

If Aiven's free plan isn't available, use any MySQL 8 host that supports triggers and SSL. Only the connection details change.

## 3. Code changes required before deploying

Make these on a branch, run tsc and both test scripts, and open a PR or commit to `main`. **Never commit `.env.local` or any secret.** It is already in `.gitignore`.

### 3.1 `src/lib/db.ts`: port, SSL and a serverless-sized pool
Hosted MySQL needs a non-default port and TLS, and serverless functions need small pools. Replace `createPool()` with:

```ts
function createPool(): mysql.Pool {
  const ca = process.env.DB_SSL_CA; // PEM text of the provider's CA cert (newlines may be literal "\n")
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: ca ? { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true } : undefined,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_LIMIT ?? 10),
    maxIdle: Number(process.env.DB_POOL_LIMIT ?? 10),
    idleTimeout: 60_000,
    enableKeepAlive: true,
    queueLimit: 0,
    timezone: '+08:00',
    dateStrings: true,
  });
}
```

- Keep the existing global-reuse lines exactly as they are.
- In production, set `DB_POOL_LIMIT=3`. Free MySQL plans allow only a few dozen connections, and each warm function instance holds its own pool.
- Add `DB_PORT`, `DB_SSL_CA` and `DB_POOL_LIMIT` to `.env.example` with comments.

### 3.2 `vercel.json`: cron schedule and region
`*/30 * * * *` is **rejected on the Vercel Hobby plan**: Hobby crons can run at most once a day, and the deploy fails. Use this unless the owner is on Pro:

```json
{
  "regions": ["sin1"],
  "crons": [
    { "path": "/api/canvas/sync/cron", "schedule": "0 22 * * *" }
  ]
}
```

- That schedule is 06:00 Manila (22:00 UTC).
- On Pro, keep `*/30 * * * *`.
- Users can still click **Sync now** in the Canvas hub, so daily auto-sync is acceptable.

### 3.3 Schema compatibility checks (MariaDB dump → MySQL 8)
- **Collations:** `schema.sql` uses `utf8mb4_general_ci` and `ENGINE=InnoDB`, which is fine on MySQL 8. If the import errors on a MariaDB-only collation such as `utf8mb4_uca1400_ai_ci`, replace it with `utf8mb4_general_ci` in the dump file, not in the repo.
- **Trigger `DEFINER`:** triggers are written as `/*!50003 CREATE*/ … TRIGGER`, with no `DEFINER` clause (verified: 0 matches). If the data dump (step 4) contains `DEFINER=`root@localhost``, strip it with `sed -E 's/DEFINER=`[^`]+`@`[^`]+`//g'`.
- **Code-level SQL:** the code uses `SELECT … FOR UPDATE` and `LOCK IN SHARE MODE`. Both work on MySQL 8 (the second is deprecated but supported). Don't "modernize" them to `FOR SHARE`, because the local MariaDB 10.4 rejects it.

## 4. Database setup: the owner does steps 4.1–4.2, the agent does the rest

### 4.1 Create the database (owner, in a browser)
1. Sign up at aiven.io. Create **MySQL**, Free plan, region in Singapore or the nearest Asia region.
2. From the service page, copy the **host, port, user, password and database name** (default database `defaultdb`; you can create `vibeboard`). Also download the **CA certificate**.
3. Leave access open to all IPs. Vercel functions have no fixed IPs.

### 4.2 Export local data (owner's PC, with XAMPP MySQL running)
```bash
"C:\xampp\mysql\bin\mysqldump.exe" -u root --single-transaction --routines --triggers --no-tablespaces vibeboard > vibeboard-dump.sql
```
- This captures the full current schema, including every column `migrate.ts` already added, plus triggers and all data.
- **Prefer this dump over `database/schema.sql`.** It is the true current state.
- **Keep the dump file out of git.** It contains users' password hashes and personal data.

### 4.3 Import into Aiven (agent)
```bash
# strip MariaDB-specific bits first if present (see 3.3), then:
mysql --host=<HOST> --port=<PORT> --user=<USER> --password --ssl-ca=ca.pem <DBNAME> < vibeboard-dump.sql
```
Verify after the import:
- `SHOW TABLES;` returns 49 or more tables, including `subject_links`, `workboard_entry_meta`, `canvas_announcement_bank` and `auth_tokens`.
- `SHOW TRIGGERS;` lists the activity, quiz and exam status triggers.
- `SELECT COUNT(*) FROM user_login;` matches the local count.
- `SHOW COLUMNS FROM grading_categories LIKE 'include_earlier';` and `SHOW COLUMNS FROM workboard_entry_meta LIKE 'note';` both return a row. If either is missing, the app's `ensure*` functions add them on first request; that's fine.

**If the dump import fails on triggers** (some hosts need `log_bin_trust_function_creators`), create the triggers without `DEFINER`. Aiven allows this by default. As a last resort, import with `--skip-triggers` and re-create the three triggers from `database/schema.sql` lines 45–90.

## 5. Vercel project (owner creates it, agent fills settings)

1. vercel.com → **Add New Project** → import `stfnnnnnnn/VibeBoard`. Framework is detected as Next.js. Root directory is the repo root. Leave the build command at its default.
2. **Node.js version:** 22.x (Project Settings → General).
3. **Function region:** Singapore (`sin1`). This is also set in `vercel.json`.
4. **Environment variables**, for Production and Preview:

| Key | Value |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` | From Aiven |
| `DB_SSL_CA` | Contents of the Aiven CA `.pem` (paste the PEM text) |
| `DB_POOL_LIMIT` | `3` |
| `AUTH_SECRET` | **Generate a new one** with `npx auth secret`. The local value is a public placeholder and must not be reused. |
| `AUTH_URL` | `https://<your-project>.vercel.app` (the final production URL, no trailing slash) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | From Google Cloud. The public ID is the same value as the client ID. |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EMAIL_FROM_NAME` | Gmail plus an App Password, for password reset and verification mail |
| `CANVAS_TOKEN_ENC_KEY` | **Copy the exact local value** from `.env.local`. Stored Canvas tokens were encrypted with it. A new key breaks every existing Canvas connection. |
| `CRON_SECRET` | Any long random string. Vercel sends it as a Bearer token to the cron route. |
| `WEATHER_API_KEY`, `QUOTES_API_KEY` | Optional dashboard widgets. Copy from local. |

5. **Google OAuth** (Google Cloud Console → Credentials → the OAuth client), add:
   - Authorized JavaScript origins: `https://<your-project>.vercel.app`
   - Authorized redirect URIs: `https://<your-project>.vercel.app/api/auth/callback/google`

   Keep the localhost entries for development.
6. Deploy. If you later add a custom domain, update `AUTH_URL` and the Google URIs to match, then redeploy.

## 6. Verify the deployment (agent)

Run these against the production URL. All of them must pass.

1. **Build:** the Vercel build log shows `next build` succeeded, with no type errors.
2. **Logged out:**
   - `curl -s -o /dev/null -w "%{http_code}" https://<url>/api/studypulse/grading` returns **401**.
   - `curl -s -o /dev/null -w "%{http_code}" https://<url>/studypulse` returns **307** (a redirect to login).
3. **Landing page:** `https://<url>/` returns 200 and shows the hero card.
4. **Sign in:**
   - Email/password works for an existing local user, which proves the data and password hashes migrated.
   - Google sign-in completes, with no `redirect_uri_mismatch`.
5. **Pages, signed in:**
   - `/studypulse` lists subjects with grades.
   - `/studypulse/<id>` shows tiles, the summary, the setup sheet, and a grade that matches local.
   - `/workboard`, `/finance` and `/habits` load.
   - `/studypulse/canvas` loads the hub.
6. **Writes:** create, edit and delete a test entry, then delete it. Check that it persists across a reload.
7. **Cron:** in Vercel → Crons, trigger `/api/canvas/sync/cron` manually. It returns 200 and the function log shows no auth error.
8. **Email:** request a password reset for a test account and confirm the mail arrives.
9. **Logs:** Vercel function logs show no `ER_*`, `ETIMEDOUT`, `Too many connections` or SSL errors. If you see "Too many connections", lower `DB_POOL_LIMIT` to 2.

## 7. Known pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Deploy fails on cron | Hobby plan schedule more often than daily | Use the daily schedule from §3.2 |
| `ETIMEDOUT` / `ECONNREFUSED` to DB | Wrong port, or Aiven IP allow-list | Use Aiven's port; allow `0.0.0.0/0` |
| `HANDSHAKE_SSL_ERROR` / self-signed cert | CA missing or newlines mangled | Paste the PEM into `DB_SSL_CA`; the code converts literal `\n` |
| Login loops back to `/login` | `AUTH_URL` doesn't match the real URL, or `AUTH_SECRET` missing | Fix both env vars and redeploy |
| Google `redirect_uri_mismatch` | Prod URIs not added in Google Cloud | §5 step 5 |
| Canvas shows "Needs reconnect" for everyone | `CANVAS_TOKEN_ENC_KEY` differs from local | Copy the exact local key |
| Times or dates off by 8 hours | Pool timezone changed | Keep `timezone: '+08:00'` and `dateStrings: true` |
| `ER_NO_SUCH_TABLE` on first requests | Partial import | Re-run the import; `ensure*` only adds tables and columns on top of the base schema |
| Graded academic items don't flip to Done | Triggers not imported | §4.3 trigger fallback |

## 8. Rules for the agent

- **Don't change application logic beyond §3.** The app is reviewed and tested; this job is deployment only.
- **Never commit secrets, the dump file, or the CA cert.** Never paste secrets into logs or PR descriptions.
- **Don't force-push to `main`.** Run `git status` before every commit; this repo has a history of unrelated staged files.
- **Don't add AI co-author lines.** No `Co-Authored-By` trailers or "Generated with" lines in commits or PRs (owner's standing rule).
- **Local `.env.local` stays as it is** for development. Production values live only in Vercel.
- **Report back:**
  - the production URL;
  - which §6 checks passed, with the output;
  - the Aiven plan and region;
  - every deviation from this document.
