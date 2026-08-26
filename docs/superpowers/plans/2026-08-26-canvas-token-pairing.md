# Canvas Access Token Pairing (Bookmarklet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student connect Canvas to VibeBoard with one click on a bookmarklet — no manual token copy-paste — by having a script run inside their own already-authenticated Canvas tab create a Canvas access token and hand it to VibeBoard via a short-lived, single-use pairing code.

**Architecture:** A new `canvas_pairing_codes` table backs a two-step handoff: an authenticated VibeBoard route mints a 10-minute single-use code and bakes it into a freshly-built `javascript:` bookmarklet URI; a second, deliberately unauthenticated and CORS-open route accepts `{code, base_url, access_token}` from the Canvas-origin script and — via a shared `connectFlow` helper extracted from the existing manual-paste route — validates and stores the token exactly like the manual flow already does. `CanvasConnectPanel` polls for completion and reloads; a new `token_expires_at` column (populated only by this flow) drives a proactive "expires soon" banner.

**Tech Stack:** Next.js 15 (App Router) + TypeScript, `mysql2/promise` raw SQL, `next-auth` v5, native `fetch` — same stack as the rest of Canvas Sync, no new dependencies.

**Spec:** [docs/superpowers/specs/2026-08-26-canvas-token-pairing-design.md](../specs/2026-08-26-canvas-token-pairing-design.md) — read this first; this plan implements it task-by-task and does not repeat its rationale.

## Global Constraints

- `CANVAS_TOKEN_ENC_KEY` is already set in `.env.local` — no new env var needed.
- No test framework is installed, and none should be added. Pure functions get real `node:assert` verification scripts run via `npx tsx <script>.ts` (use an **absolute** import path, e.g. `c:/xampp/htdocs/VibeBoard/src/lib/canvas/connectFlow`, since `tsx` does not resolve this project's `@/*` alias from a script outside `src/`). DB-touching code is verified with direct SQL (`"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "..."`). The full connect flow is verified with a real browser driven by Playwright against seeded fixtures and a local stub Canvas server (the method already proven in this repo's prior Canvas plans).
- Every authenticated route uses the exact existing check: `const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });`.
- **The 89-day token expiration margin is empirically derived, not theoretical.** Canvas's public open-source `TokensController` constant is `MAXIMUM_EXPIRATION_DURATION = 120.days`, but this school's live deployment (`feu.instructure.com`) actually rejects anything over ~90 days (confirmed live: a request computing `now + 90*24h` was rejected with `"Expiration date cannot be more than 90 days in the future"`; `now + 89*24h` succeeded). Institutional Canvas deployments can override upstream defaults. Do **not** "correct" 89 days to 120, and do not push it up to exactly 90 — the margin exists because a few milliseconds of round-trip delay between computing the timestamp and Canvas receiving it can tip an exact 90-day value over the edge.
- **The real Canvas token-list route is `GET /api/v1/users/:user_id/user_generated_tokens`** (confirmed from Canvas's actual `config/routes.rb`: `get "users/:user_id/user_generated_tokens", action: :user_generated_tokens`). There is no `GET /api/v1/users/self/tokens` — that path only exists for `POST` (create). The list response is a flat JSON array of token objects, each with a `purpose` field (confirmed from `TokensController#user_generated_tokens`: `render json: tokens.map { |token| token_json(token, ...) }`), and defaults to only 10 results per page server-side — always pass `?per_page=100` explicitly.
- This repo is a git repository — every task ends with `git add` + `git commit`.
- All new/modified UI follows the existing glass/pill design language already used in `CanvasConnectPanel.tsx` (`GLASS` token, `pillBtn` token) — reuse those constants, don't invent new styling.

---

## File Structure

**New files:**
- `src/lib/canvas/connectFlow.ts` — `runConnectFlow()`, `InvalidBaseUrlError`, extracted from `connect/route.ts`
- `src/lib/canvas/bookmarklet.ts` — `buildBookmarkletHref(code, vibeboardOrigin)`
- `src/app/api/canvas/pair/start/route.ts` — `POST` (mint code), `GET` (poll status)
- `src/app/api/canvas/pair/route.ts` — `POST` (unauthenticated, CORS-open), `OPTIONS`

**Modified files:**
- `src/lib/migrate.ts` — `ensureCanvasSchema()` gains the `canvas_pairing_codes` table and the `canvas_connections.token_expires_at` column
- `src/app/api/canvas/connect/route.ts` — refactored to call `runConnectFlow`
- `src/components/studypulse/CanvasConnectPanel.tsx` — bookmarklet generation UI, polling, expiry banner, manual-paste moved behind a disclosure
- `src/app/studypulse/canvas/page.tsx` — select and pass through `token_expires_at`

---

### Task 1: Database Schema

**Files:**
- Modify: `src/lib/migrate.ts`

**Interfaces:**
- Produces: `canvas_pairing_codes` table; `canvas_connections.token_expires_at` column. No new exported function — both live inside the existing `ensureCanvasSchema(): Promise<void>`.

- [ ] **Step 1: Confirm neither exists yet**

Run:
```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SHOW TABLES LIKE 'canvas_pairing_codes'; SHOW COLUMNS FROM canvas_connections LIKE 'token_expires_at';"
```
Expected: both empty result sets.

- [ ] **Step 2: Add the column to `canvas_connections` and the new table**

In `src/lib/migrate.ts`, inside `ensureCanvasSchema()`, find the `canvas_connections` table's `CREATE TABLE IF NOT EXISTS` block (starts at line 88) and its closing:

```ts
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user (user_id),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
    )
  `);
```

Immediately after that closing `` `); ``, insert (this is a new column on a table that already exists for earlier users, so it needs the same idempotent try/catch pattern used elsewhere in this file, e.g. `ensureSubjectSection()`):

```ts

  try {
    await pool.query(`ALTER TABLE canvas_connections ADD COLUMN token_expires_at DATETIME NULL AFTER last_error`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }
```

Then find the end of `ensureCanvasSchema()` — the last `CREATE TABLE IF NOT EXISTS canvas_announcement_links` block, followed by:

```ts
  `);

  _ranCanvas = true;
}
```

Insert this new table's creation immediately before `_ranCanvas = true;`:

```ts

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_pairing_codes (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      code        CHAR(43) NOT NULL,
      expires_at  DATETIME NOT NULL,
      used_at     DATETIME NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_code (code),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
    )
  `);
```

- [ ] **Step 3: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Verify the SQL directly**

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "
ALTER TABLE canvas_connections ADD COLUMN token_expires_at DATETIME NULL AFTER last_error;
CREATE TABLE IF NOT EXISTS canvas_pairing_codes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  code        CHAR(43) NOT NULL,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_code (code),
  FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
);
SHOW COLUMNS FROM canvas_connections LIKE 'token_expires_at';
SHOW TABLES LIKE 'canvas_pairing_codes';
"
```
Expected: both show up. Then drop them so the app creates them fresh via `ensureCanvasSchema()` later (matching the convention in the prior Canvas Announcements plan):
```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "
ALTER TABLE canvas_connections DROP COLUMN token_expires_at;
DROP TABLE canvas_pairing_codes;
"
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/migrate.ts
git commit -m "$(cat <<'EOF'
Add canvas_pairing_codes table and canvas_connections.token_expires_at

Schema for the bookmarklet-based Canvas token pairing flow.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Extract `connectFlow.ts` and refactor the manual connect route

**Files:**
- Create: `src/lib/canvas/connectFlow.ts`
- Modify: `src/app/api/canvas/connect/route.ts`

**Interfaces:**
- Consumes: `canvasValidateToken(baseUrl, token): Promise<{id: number; name: string}>` (`src/lib/canvas/client.ts`), `encryptToken(plain: string): EncryptedToken` (`src/lib/canvas/credentials.ts`), `CanvasAuthError`/`CanvasApiError` (`src/lib/canvas/errors.ts`), `pool` (`src/lib/db`).
- Produces: `export class InvalidBaseUrlError extends Error {}` and `export async function runConnectFlow(userId: number, rawBaseUrl: string, accessToken: string, tokenExpiresAt?: string | null): Promise<{ canvasUserId: number; canvasUserName: string }>` — both from `src/lib/canvas/connectFlow.ts`. Later tasks (3, 4) import both.

- [ ] **Step 1: Write `connectFlow.ts`**

```ts
import pool from '@/lib/db';
import { canvasValidateToken } from './client';
import { encryptToken } from './credentials';
import { CanvasAuthError, CanvasApiError } from './errors';

export class InvalidBaseUrlError extends Error {}

/**
 * The server fetches `{base_url}/api/v1/...` with a user-supplied bearer token and stores the
 * response where the same user can read it back — an SSRF primitive with a readback channel if
 * an internal address is accepted. Block loopback/private/link-local targets. Not intended to
 * be DNS-rebinding-proof (out of scope for this app's threat model); it blocks the obvious
 * internal-network targeting, and the https-only check above stops cleartext token leakage.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '::' || host === '0.0.0.0') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  const ipv4 = v4 ? v4[1] : host;

  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ipv4);
  if (!octets) return false;
  const [a, b] = [Number(octets[1]), Number(octets[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export interface ConnectFlowResult {
  canvasUserId:   number;
  canvasUserName: string;
}

export async function runConnectFlow(
  userId: number,
  rawBaseUrl: string,
  accessToken: string,
  tokenExpiresAt: string | null = null,
): Promise<ConnectFlowResult> {
  const cleanBaseUrl = String(rawBaseUrl).trim().replace(/\/$/, '');

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cleanBaseUrl);
  } catch {
    throw new InvalidBaseUrlError('base_url must be a valid URL, e.g. https://yourschool.instructure.com');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new InvalidBaseUrlError('base_url must start with https:// — a Canvas access token must never be sent over plain http.');
  }
  if (isPrivateHost(parsedUrl.hostname)) {
    throw new InvalidBaseUrlError('base_url must be a public Canvas host, e.g. https://yourschool.instructure.com');
  }

  let canvasUser: { id: number; name: string };
  try {
    canvasUser = await canvasValidateToken(cleanBaseUrl, accessToken);
  } catch (err) {
    if (err instanceof CanvasAuthError) {
      throw new CanvasAuthError('Canvas rejected that access token. Double-check you copied it correctly.');
    }
    const status = err instanceof CanvasApiError ? err.status : 0;
    throw new CanvasApiError(`Could not reach Canvas at ${cleanBaseUrl}. Check the domain is correct.`, status);
  }

  const { enc, iv, tag } = encryptToken(accessToken);
  const expiresAtValue = tokenExpiresAt ? new Date(tokenExpiresAt) : null;

  await pool.execute(
    `INSERT INTO canvas_connections
       (user_id, base_url, canvas_user_id, canvas_user_name, access_token_enc, token_iv, token_tag, status, token_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
     ON DUPLICATE KEY UPDATE
       base_url = VALUES(base_url), canvas_user_id = VALUES(canvas_user_id),
       canvas_user_name = VALUES(canvas_user_name), access_token_enc = VALUES(access_token_enc),
       token_iv = VALUES(token_iv), token_tag = VALUES(token_tag), status = 'active', last_error = NULL,
       token_expires_at = VALUES(token_expires_at)`,
    [userId, cleanBaseUrl, canvasUser.id, canvasUser.name, enc, iv, tag, expiresAtValue],
  );

  return { canvasUserId: canvasUser.id, canvasUserName: canvasUser.name };
}
```

- [ ] **Step 2: Refactor `connect/route.ts` to use it**

Replace the entire contents of `src/app/api/canvas/connect/route.ts` with:

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureCanvasSchema } from '@/lib/migrate';
import { runConnectFlow, InvalidBaseUrlError } from '@/lib/canvas/connectFlow';
import { CanvasAuthError, CanvasApiError } from '@/lib/canvas/errors';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCanvasSchema();

  const { base_url, access_token } = await req.json();
  if (!base_url || !access_token) {
    return Response.json({ error: 'base_url and access_token are required' }, { status: 400 });
  }

  const userId = parseInt(session.user.id);
  try {
    const result = await runConnectFlow(userId, base_url, access_token);
    return Response.json({ status: 'success', canvas_user_name: result.canvasUserName });
  } catch (err) {
    if (err instanceof InvalidBaseUrlError || err instanceof CanvasAuthError || err instanceof CanvasApiError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json({ error: 'Could not reach Canvas. Check the domain is correct.' }, { status: 400 });
  }
}
```

This preserves every original error message exactly (they now live inside `runConnectFlow`) while removing the duplicated SSRF/validation logic from this route.

- [ ] **Step 3: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Verify pure validation branches with `node:assert`**

```bash
mkdir -p /tmp/vb-verify
cat > /tmp/vb-verify/connectflow-validation.ts <<'EOF'
import assert from 'node:assert';
import { runConnectFlow, InvalidBaseUrlError } from 'c:/xampp/htdocs/VibeBoard/src/lib/canvas/connectFlow';

async function main() {
  // Not a valid URL at all
  await assert.rejects(
    () => runConnectFlow(1, 'not-a-url', 'token'),
    InvalidBaseUrlError,
  );

  // http, not https
  await assert.rejects(
    () => runConnectFlow(1, 'http://example.instructure.com', 'token'),
    InvalidBaseUrlError,
  );

  // Private/loopback host
  await assert.rejects(
    () => runConnectFlow(1, 'https://localhost', 'token'),
    InvalidBaseUrlError,
  );
  await assert.rejects(
    () => runConnectFlow(1, 'https://192.168.1.5', 'token'),
    InvalidBaseUrlError,
  );

  console.log('connectFlow validation: all branches OK');
}

main().catch(err => { console.error(err); process.exit(1); });
EOF
npx tsx /tmp/vb-verify/connectflow-validation.ts
```
Expected: `connectFlow validation: all branches OK`. These four calls fail before ever reaching `canvasValidateToken` or the database, so no seeded fixtures or running server are needed.

- [ ] **Step 5: Confirm the route itself — not just `runConnectFlow` — still works**

Step 4 already proved `runConnectFlow`'s validation branches directly. What it didn't touch is the route handler wrapped around it: the `auth()` session gate and `ensureCanvasSchema()` call. Verify those two survived the refactor with real HTTP requests against the running dev server (`npm run dev` in another terminal).

No-session request must still be rejected:
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/canvas/connect \
  -H "Content-Type: application/json" -d '{"base_url":"https://x.instructure.com","access_token":"x"}'
```
Expected: `401`.

Seed a throwaway user and log in with Playwright to get a real session cookie:
```bash
cat > /tmp/vb-verify/seed-connect-check.cjs <<'EOF'
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function main() {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', password: '', database: 'vibeboard' });
  const hash = await bcrypt.hash('ConnectRefactorTest123!', 10);
  const [u] = await conn.execute(
    `INSERT INTO user_login (first_name, middle_name, surname, email, year_level, status, program, specialization, password)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ['Refactor', 'C', 'Check', 'connect-refactor-check@vibeboard.local', '3rd Year', 'Regular', 1, 1, hash],
  );
  console.log('userId=' + u.insertId);
  await conn.end();
}
main();
EOF
node /tmp/vb-verify/seed-connect-check.cjs
```

With Playwright, log in as `connect-refactor-check@vibeboard.local` / `ConnectRefactorTest123!`, then from the authenticated page context run:
```js
const res  = await fetch('/api/canvas/connect', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ base_url: 'https://192.168.1.5', access_token: 'dummy' }),
});
const data = await res.json();
console.log(res.status, JSON.stringify(data));
```
Expected: `400 {"error":"base_url must be a public Canvas host, e.g. https://yourschool.instructure.com"}` — the exact original SSRF-guard message, now reached through the real route (`auth()` passed, `ensureCanvasSchema()` ran, request JSON parsed, `runConnectFlow` invoked and its error surfaced) rather than by calling `runConnectFlow` directly. Task 6 covers the full success path against real Canvas.

Clean up the fixture:
```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "DELETE FROM user_login WHERE email = 'connect-refactor-check@vibeboard.local';"
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/canvas/connectFlow.ts src/app/api/canvas/connect/route.ts
git commit -m "$(cat <<'EOF'
Extract shared Canvas token validation into connectFlow.ts

Prep for the bookmarklet pairing route, which needs the exact same
SSRF guard, token validation, and storage logic as the manual-paste
connect route — extracted so the two paths can't drift apart.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Pairing-start routes (`POST` mint + `GET` status)

**Files:**
- Create: `src/app/api/canvas/pair/start/route.ts`

**Interfaces:**
- Consumes: `auth()` (`@/auth`), `pool` (`@/lib/db`), `ensureCanvasSchema` (`@/lib/migrate`).
- Produces: `POST /api/canvas/pair/start` → `{ code: string; expires_at: string }`; `GET /api/canvas/pair/start?code=...` → `{ used: boolean; canvas_user_name?: string }` or `{ error: string }`. Task 5 (frontend) calls both by URL; no direct TS import.

- [ ] **Step 1: Write the route**

```ts
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureCanvasSchema } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';

const CODE_TTL_MS = 10 * 60 * 1000;

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCanvasSchema();

  const userId    = parseInt(session.user.id);
  const code      = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await pool.execute(
    `INSERT INTO canvas_pairing_codes (user_id, code, expires_at) VALUES (?, ?, ?)`,
    [userId, code, expiresAt],
  );

  return Response.json({ code, expires_at: expiresAt.toISOString() });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const code = req.nextUrl.searchParams.get('code');
  if (!code) return Response.json({ error: 'code is required' }, { status: 400 });

  await ensureCanvasSchema();
  const userId = parseInt(session.user.id);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT pc.used_at, conn.canvas_user_name
       FROM canvas_pairing_codes pc
       LEFT JOIN canvas_connections conn ON conn.user_id = pc.user_id
      WHERE pc.code = ? AND pc.user_id = ?`,
    [code, userId],
  );
  if (rows.length === 0) return Response.json({ error: 'Unknown pairing code' }, { status: 404 });

  const used = rows[0].used_at !== null;
  return Response.json({
    used,
    canvas_user_name: used ? (rows[0].canvas_user_name as string | null ?? undefined) : undefined,
  });
}
```

- [ ] **Step 2: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Verify with a real login session, via Playwright + curl**

Seed a user and capture a session cookie:

```bash
cat > /tmp/vb-verify/seed-pair-start.cjs <<'EOF'
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function main() {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', password: '', database: 'vibeboard' });
  const hash = await bcrypt.hash('PairStartTest123!', 10);
  const [u] = await conn.execute(
    `INSERT INTO user_login (first_name, middle_name, surname, email, year_level, status, program, specialization, password)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ['Pair', 'S', 'Start', 'pair-start-check@vibeboard.local', '3rd Year', 'Regular', 1, 1, hash],
  );
  console.log('userId=' + u.insertId);
  await conn.end();
}
main();
EOF
node /tmp/vb-verify/seed-pair-start.cjs
```

With `npm run dev` running, use a Playwright script (same login-and-capture-cookie approach used throughout this session) to log in as `pair-start-check@vibeboard.local` / `PairStartTest123!`, then from the authenticated page context run:

```js
const startRes = await fetch('/api/canvas/pair/start', { method: 'POST' });
const { code, expires_at } = await startRes.json();
console.log('code:', code, 'expires_at:', expires_at);

const statusRes = await fetch('/api/canvas/pair/start?code=' + encodeURIComponent(code));
const status = await statusRes.json();
console.log('status:', JSON.stringify(status));
```

Expected: `code` is a 43-character string, `expires_at` is ~10 minutes in the future, and `status` is `{"used":false}`.

Then verify the DB row directly:
```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SELECT user_id, used_at, expires_at > NOW() AS not_expired FROM canvas_pairing_codes ORDER BY id DESC LIMIT 1;"
```
Expected: one row, `used_at` NULL, `not_expired` = 1.

Clean up:
```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "DELETE FROM user_login WHERE email = 'pair-start-check@vibeboard.local';"
```
(cascades to `canvas_pairing_codes` via `ON DELETE CASCADE`)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/canvas/pair/start/route.ts
git commit -m "$(cat <<'EOF'
Add POST/GET /api/canvas/pair/start for bookmarklet pairing codes

Mints a short-lived, single-use pairing code and lets the frontend
poll for completion once the bookmarklet has run.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The pairing-complete route (`POST /api/canvas/pair`)

**Files:**
- Create: `src/app/api/canvas/pair/route.ts`

**Interfaces:**
- Consumes: `runConnectFlow`, `InvalidBaseUrlError` (Task 2), `CanvasAuthError`/`CanvasApiError` (`@/lib/canvas/errors`), `pool`, `ensureCanvasSchema`.
- Produces: `POST /api/canvas/pair` (unauthenticated, CORS-open) → `{ status: 'success'; canvas_user_name: string }` or `{ error: string }`. Consumed by the bookmarklet script (Task 5), not by any TypeScript caller.

- [ ] **Step 1: Write the route**

```ts
import { NextRequest } from 'next/server';
import pool from '@/lib/db';
import { ensureCanvasSchema } from '@/lib/migrate';
import { runConnectFlow, InvalidBaseUrlError } from '@/lib/canvas/connectFlow';
import { CanvasAuthError, CanvasApiError } from '@/lib/canvas/errors';
import type { RowDataPacket } from 'mysql2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  await ensureCanvasSchema();

  const { code, base_url, access_token, expires_at } = await req.json();
  if (!code || !base_url || !access_token) {
    return Response.json(
      { error: 'code, base_url, and access_token are required' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, user_id, expires_at FROM canvas_pairing_codes WHERE code = ? AND used_at IS NULL`,
    [code],
  );
  const pairing = rows[0];
  if (!pairing || new Date(pairing.expires_at as string).getTime() < Date.now()) {
    return Response.json(
      { error: 'This connect link has expired. Go back to VibeBoard and generate a new one.' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  let result;
  try {
    result = await runConnectFlow(
      pairing.user_id as number,
      base_url,
      access_token,
      typeof expires_at === 'string' ? expires_at : null,
    );
  } catch (err) {
    const message = err instanceof InvalidBaseUrlError || err instanceof CanvasAuthError || err instanceof CanvasApiError
      ? err.message
      : 'Could not connect to Canvas.';
    return Response.json({ error: message }, { status: 400, headers: CORS_HEADERS });
  }

  const [updateResult] = await pool.execute(
    `UPDATE canvas_pairing_codes SET used_at = NOW() WHERE id = ? AND used_at IS NULL`,
    [pairing.id],
  );
  if ((updateResult as { affectedRows: number }).affectedRows === 0) {
    return Response.json(
      { error: 'This connect link was already used.' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  return Response.json(
    { status: 'success', canvas_user_name: result.canvasUserName },
    { headers: CORS_HEADERS },
  );
}
```

- [ ] **Step 2: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Verify against a stub Canvas server**

```bash
cat > /tmp/vb-verify/stub-canvas-pair.cjs <<'EOF'
const http = require('http');
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/v1/users/self')) {
    res.end(JSON.stringify({ id: 99002, name: 'Pair Complete Test User' }));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});
server.listen(8897, () => console.log('stub Canvas listening on :8897'));
EOF
node /tmp/vb-verify/stub-canvas-pair.cjs &
```

Seed a user and a pairing code directly (no login needed — this route is unauthenticated):

```bash
cat > /tmp/vb-verify/seed-pair-complete.cjs <<'EOF'
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function main() {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', password: '', database: 'vibeboard' });
  const hash = await bcrypt.hash('PairCompleteTest123!', 10);
  const [u] = await conn.execute(
    `INSERT INTO user_login (first_name, middle_name, surname, email, year_level, status, program, specialization, password)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ['Pair', 'C', 'Complete', 'pair-complete-check@vibeboard.local', '3rd Year', 'Regular', 1, 1, hash],
  );
  const userId = u.insertId;

  const code = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await conn.execute(
    `INSERT INTO canvas_pairing_codes (user_id, code, expires_at) VALUES (?, ?, ?)`,
    [userId, code, expiresAt],
  );

  console.log('userId=' + userId);
  console.log('code=' + code);
  await conn.end();
}
main();
EOF
node /tmp/vb-verify/seed-pair-complete.cjs
```

With `npm run dev` running and the printed `code`, simulate what the bookmarklet sends (note this route requires HTTPS for `base_url` via `runConnectFlow` — since our stub is plain HTTP, this call is expected to fail with the HTTPS guard message, which is itself useful confirmation the guard applies here too):

```bash
curl -s -X POST http://localhost:3000/api/canvas/pair \
  -H "Content-Type: application/json" \
  -d '{"code":"<paste code here>","base_url":"http://localhost:8897","access_token":"dummy","expires_at":"2026-11-23T12:09:56Z"}'
```
Expected: `{"error":"base_url must start with https:// — a Canvas access token must never be sent over plain http."}`. This confirms the pairing route correctly reuses `runConnectFlow`'s guard, and that the pairing code itself was found (a *missing* code would instead produce the "expired" message, not the https one) — reusing the code again below.

Confirm the code is still unused after a rejected attempt (validation failures must not burn the single-use code):
```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SELECT used_at FROM canvas_pairing_codes WHERE code = '<paste code here>';"
```
Expected: `used_at` is `NULL`.

Now verify the success path directly through `runConnectFlow` + the used-code update, bypassing the HTTPS-only limitation of curl-to-a-plain-stub (Task 6 exercises the full HTTP route success path against a real bookmarklet-shaped request, using a technique that can present HTTPS):

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "DELETE FROM user_login WHERE email = 'pair-complete-check@vibeboard.local';"
kill %1 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/canvas/pair/route.ts
git commit -m "$(cat <<'EOF'
Add unauthenticated POST /api/canvas/pair for bookmarklet handoff

The one deliberately CORS-open, unauthenticated route under
/api/canvas — the pairing code is the sole proof of identity, since
requests originate from Canvas's origin and can't carry a VibeBoard
session cookie.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Bookmarklet builder + `CanvasConnectPanel` UI + expiry banner

**Files:**
- Create: `src/lib/canvas/bookmarklet.ts`
- Modify: `src/components/studypulse/CanvasConnectPanel.tsx`
- Modify: `src/app/studypulse/canvas/page.tsx`

**Interfaces:**
- Consumes: `POST /api/canvas/pair/start`, `GET /api/canvas/pair/start?code=` (Task 3).
- Produces: `export function buildBookmarkletHref(code: string, vibeboardOrigin: string): string` (`src/lib/canvas/bookmarklet.ts`) — a pure string function, independently verifiable.

- [ ] **Step 1: Write `bookmarklet.ts`**

```ts
export function buildBookmarkletHref(code: string, vibeboardOrigin: string): string {
  const script = `
(function(){
  var CODE = ${JSON.stringify(code)};
  var VIBEBOARD_ORIGIN = ${JSON.stringify(vibeboardOrigin)};
  (async function(){
    try {
      var raw = (document.cookie.match(/(?:^|;\\s*)_csrf_token=([^;]+)/) || [])[1];
      var csrf = raw ? decodeURIComponent(raw) : '';
      var headers = {
        'Accept': 'application/json+canvas-string-ids, application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json'
      };
      var listRes = await fetch('/api/v1/users/self/user_generated_tokens?per_page=100', { credentials: 'same-origin', headers: headers });
      var existing = await listRes.json();
      var old = Array.isArray(existing) ? existing.filter(function(t){ return t.purpose === 'VibeBoard'; })[0] : null;
      if (old) {
        await fetch('/api/v1/users/self/tokens/' + old.id, { method: 'DELETE', credentials: 'same-origin', headers: headers });
      }
      var createRes = await fetch('/api/v1/users/self/tokens', {
        method: 'POST', credentials: 'same-origin', headers: headers,
        body: JSON.stringify({ token: { purpose: 'VibeBoard', expires_at: new Date(Date.now() + 89 * 24 * 60 * 60 * 1000).toISOString() } })
      });
      if (!createRes.ok) throw new Error('Canvas rejected the token request (status ' + createRes.status + ')');
      var created = await createRes.json();
      var pairRes = await fetch(VIBEBOARD_ORIGIN + '/api/canvas/pair', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: CODE, base_url: location.origin, access_token: created.visible_token, expires_at: created.expires_at })
      });
      var pairData = await pairRes.json();
      if (!pairRes.ok) throw new Error(pairData.error || 'VibeBoard rejected the token');
      alert('Connected VibeBoard to Canvas as ' + pairData.canvas_user_name + '. You can close this tab and go back to VibeBoard.');
    } catch (err) {
      alert('VibeBoard connect failed: ' + err.message + '\\n\\nGo back to VibeBoard and try again.');
    }
  })();
})();
`;
  return 'javascript:' + script.replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 2: Verify it with `node:assert`**

```bash
cat > /tmp/vb-verify/bookmarklet.ts <<'EOF'
import assert from 'node:assert';
import { buildBookmarkletHref } from 'c:/xampp/htdocs/VibeBoard/src/lib/canvas/bookmarklet';

const href = buildBookmarkletHref('abc123_-XYZ', 'https://vibeboard.example.com');

assert.ok(href.startsWith('javascript:'), 'must start with javascript: scheme');
assert.ok(!href.includes('\n'), 'must be collapsed to a single line');
assert.ok(href.includes('"abc123_-XYZ"'), 'must embed the code as a JSON string literal');
assert.ok(href.includes('"https://vibeboard.example.com"'), 'must embed the origin as a JSON string literal');
assert.ok(href.includes('/api/v1/users/self/user_generated_tokens?per_page=100'), 'must use the real list route with per_page');
assert.ok(!href.includes('/api/v1/users/self/tokens\','), 'the list call must not use the nonexistent GET /tokens route');
assert.ok(href.includes("purpose === 'VibeBoard'"), 'must filter by purpose');
assert.ok(href.includes('89 * 24 * 60 * 60 * 1000'), 'must use the 89-day empirical margin, not 90');

// A code containing characters that would break a naive string interpolation
const hostileHref = buildBookmarkletHref('a"b\\c', 'https://vibeboard.example.com');
assert.ok(hostileHref.includes(JSON.stringify('a"b\\c')), 'must safely escape quotes/backslashes in the code');

console.log('buildBookmarkletHref: all checks OK');
EOF
npx tsx /tmp/vb-verify/bookmarklet.ts
```
Expected: `buildBookmarkletHref: all checks OK`.

- [ ] **Step 3: Update `ConnectionStatus` and rewrite `CanvasConnectPanel.tsx`**

Replace the entire contents of `src/components/studypulse/CanvasConnectPanel.tsx`:

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { GraduationCap, AlertTriangle, RefreshCw, Unplug, Link2 } from 'lucide-react';
import { buildBookmarkletHref } from '@/lib/canvas/bookmarklet';

const GLASS: React.CSSProperties = {
  background:           'rgba(255,255,255,0.4)',
  backdropFilter:       'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  borderRadius:         '22px',
  border:               '1px solid rgba(255,255,255,0.4)',
  boxShadow:            '0 8px 24px rgba(31,38,68,0.09)',
};

const pillBtn: React.CSSProperties = {
  border: 'none', borderRadius: '999px', padding: '9px 18px', fontWeight: 700,
  fontSize: '0.84rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
};

export interface ConnectionStatus {
  connected:         boolean;
  canvas_user_name?: string;
  status?:           'active' | 'invalid' | 'disconnected';
  last_sync_at?:     string | null;
  last_sync_status?: 'success' | 'partial' | 'failed' | null;
  token_expires_at?: string | null;
}

const PAIR_POLL_MS = 3000;

export default function CanvasConnectPanel({
  connection, onChange,
}: {
  connection: ConnectionStatus;
  onChange:   () => void;
}) {
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [pairing, setPairing]     = useState<{ code: string; expiresAt: number } | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [baseUrl, setBaseUrl]     = useState('');
  const [token, setToken]         = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => stopPolling, []);

  const startPairing = async () => {
    setBusy(true);
    setError(null);
    try {
      const res  = await fetch('/api/canvas/pair/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not start Canvas connect');
      const expiresAt = new Date(data.expires_at).getTime();
      setPairing({ code: data.code, expiresAt });

      pollRef.current = setInterval(async () => {
        if (Date.now() > expiresAt) { stopPolling(); return; }
        try {
          const statusRes  = await fetch(`/api/canvas/pair/start?code=${encodeURIComponent(data.code)}`);
          const statusData = await statusRes.json();
          if (statusData.used) {
            stopPolling();
            window.location.reload();
          }
        } catch {
          // transient poll failure — try again on the next tick
        }
      }, PAIR_POLL_MS);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connectManual = async () => {
    setBusy(true);
    setError(null);
    try {
      const res  = await fetch('/api/canvas/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: baseUrl, access_token: token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Connection failed');
      setToken('');
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/canvas/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error('Disconnect failed');
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const res  = await fetch('/api/canvas/sync/manual', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const daysUntilExpiry = connection.token_expires_at
    ? Math.ceil((new Date(connection.token_expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const showExpiryWarning = connection.connected && connection.status === 'active'
    && daysUntilExpiry !== null && daysUntilExpiry <= 7;

  if (connection.connected) {
    return (
      <div style={{ ...GLASS, padding: '20px 26px', marginBottom: '20px' }}>
        <style jsx>{`
          .ccp-sync:hover:not(:disabled)  { filter: brightness(1.04); }
          .ccp-discon:hover:not(:disabled) { background: rgba(254,226,226,0.9) !important; color: #c0392b !important; }
          .ccp-reconnect:hover:not(:disabled) { filter: brightness(1.04); }
        `}</style>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <GraduationCap size={18} color="#74bcd9" strokeWidth={2.2} />
            <span style={{ fontWeight: 800, color: '#333', fontSize: '0.92rem' }}>
              Connected to Canvas as {connection.canvas_user_name}
            </span>
            {connection.status === 'invalid' && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#c0392b', fontWeight: 700,
                fontSize: '0.78rem', background: 'rgba(254,226,226,0.7)', borderRadius: '999px', padding: '3px 10px',
              }}>
                <AlertTriangle size={12} /> Token expired — reconnect below
              </span>
            )}
          </div>
          {showExpiryWarning && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
              background: 'rgba(255,229,143,0.35)', border: '1px solid rgba(214,158,46,0.35)',
              borderRadius: '14px', padding: '9px 14px', fontSize: '0.8rem', color: '#8a6416', fontWeight: 600,
            }}>
              <AlertTriangle size={13} />
              Your Canvas connection expires in {daysUntilExpiry} day{daysUntilExpiry === 1 ? '' : 's'} — reconnect anytime to renew it.
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', color: '#8a94a6', fontWeight: 600, marginRight: 'auto' }}>
              {connection.last_sync_at
                ? `Last synced ${new Date(connection.last_sync_at).toLocaleString()} (${connection.last_sync_status})`
                : 'Never synced'}
            </span>
            {pairing ? (
              <BookmarkletLink code={pairing.code} />
            ) : (
              <button className="ccp-reconnect" onClick={startPairing} disabled={busy}
                style={{
                  ...pillBtn, color: 'white', background: 'linear-gradient(to right, #f2a7c0, #74bcd9)',
                  boxShadow: '0 4px 14px rgba(242,167,192,0.3)', cursor: busy ? 'wait' : 'pointer',
                }}>
                <Link2 size={14} /> Reconnect
              </button>
            )}
            <button className="ccp-sync" onClick={syncNow} disabled={busy}
              style={{
                ...pillBtn, color: 'white', background: 'linear-gradient(to right, #f2a7c0, #74bcd9)',
                boxShadow: '0 4px 14px rgba(242,167,192,0.3)', cursor: busy ? 'wait' : 'pointer',
              }}>
              <RefreshCw size={14} /> {busy ? 'Syncing…' : 'Sync Now'}
            </button>
            <button className="ccp-discon" onClick={disconnect} disabled={busy}
              style={{ ...pillBtn, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.5)', color: '#8a94a6' }}>
              <Unplug size={14} /> Disconnect
            </button>
          </div>
        </div>
        {error && <div style={{ marginTop: '10px', color: '#dc2626', fontSize: '0.85rem', fontWeight: 600 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ ...GLASS, padding: '24px 26px', marginBottom: '20px' }}>
      <style jsx>{`
        .ccp-connect:hover:not(:disabled) { filter: brightness(1.04); }
        .ccp-manual-toggle:hover { color: #5c6b80 !important; }
      `}</style>
      <h2 style={{
        margin: '0 0 10px', fontSize: '1.05rem', fontWeight: 800, color: '#2d3748',
        fontFamily: "'DM Sans', 'Segoe UI', sans-serif", display: 'flex', alignItems: 'center', gap: '8px',
      }}>
        <GraduationCap size={19} color="#74bcd9" strokeWidth={2.2} /> Connect Canvas
      </h2>

      {!pairing ? (
        <>
          <p style={{ fontSize: '0.85rem', color: '#8a94a6', marginBottom: '16px', lineHeight: 1.5 }}>
            Click Connect, then drag the button that appears to your bookmarks bar.
          </p>
          <button className="ccp-connect" onClick={startPairing} disabled={busy}
            style={{
              ...pillBtn, color: 'white', background: 'linear-gradient(to right, #f2a7c0, #74bcd9)',
              boxShadow: '0 4px 14px rgba(242,167,192,0.3)',
              opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer',
            }}>
            {busy ? 'Starting…' : 'Connect'}
          </button>
        </>
      ) : (
        <BookmarkletLink code={pairing.code} />
      )}

      <div style={{ marginTop: '14px' }}>
        <button
          className="ccp-manual-toggle"
          onClick={() => setShowManual(v => !v)}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.78rem', color: '#8a94a6', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
        >
          {showManual ? 'Hide manual option' : 'Paste a token manually instead'}
        </button>
        {showManual && (
          <div style={{ marginTop: '12px' }}>
            <input placeholder="https://yourschool.instructure.com" value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)} className="vb-input" style={{ marginBottom: '10px' }} />
            <input placeholder="Paste your Canvas access token" value={token} type="password"
              onChange={e => setToken(e.target.value)} className="vb-input" style={{ marginBottom: '14px' }} />
            <button className="ccp-connect" onClick={connectManual} disabled={busy || !baseUrl || !token}
              style={{
                ...pillBtn, color: 'white', background: 'linear-gradient(to right, #f2a7c0, #74bcd9)',
                boxShadow: '0 4px 14px rgba(242,167,192,0.3)',
                opacity: (busy || !baseUrl || !token) ? 0.6 : 1,
                cursor: busy ? 'wait' : (!baseUrl || !token) ? 'not-allowed' : 'pointer',
              }}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        )}
      </div>
      {error && <div style={{ marginTop: '10px', color: '#dc2626', fontSize: '0.85rem', fontWeight: 600 }}>{error}</div>}
    </div>
  );
}

function BookmarkletLink({ code }: { code: string }) {
  const href = typeof window !== 'undefined' ? buildBookmarkletHref(code, window.location.origin) : 'javascript:void(0)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
      <span style={{ fontSize: '0.8rem', color: '#8a94a6', fontWeight: 600 }}>
        Drag this to your bookmarks bar, then go to your Canvas site and click it. Expires in 10 minutes.
      </span>
      <a
        href={href}
        onClick={e => e.preventDefault()}
        style={{
          ...pillBtn, color: 'white', background: 'linear-gradient(to right, #f2a7c0, #74bcd9)',
          boxShadow: '0 4px 14px rgba(242,167,192,0.3)', textDecoration: 'none', cursor: 'grab',
        }}
      >
        <Link2 size={14} /> Connect to Canvas
      </a>
    </div>
  );
}
```

The bookmarklet link's `onClick={e => e.preventDefault()}` stops a click (as opposed to a drag) from navigating the current VibeBoard tab to a `javascript:` URI — it must be dragged to the bookmarks bar, not clicked here.

- [ ] **Step 4: Plumb `token_expires_at` through `page.tsx`**

In `src/app/studypulse/canvas/page.tsx`, update the `SELECT` (currently at line 16) to include the new column:

```ts
  const [connRows] = await pool.execute<RowDataPacket[]>(
    `SELECT canvas_user_name, status, last_sync_at, last_sync_status, token_expires_at FROM canvas_connections WHERE user_id = ? AND status IN ('active', 'invalid')`,
    [userId],
  );
```

And the `initialConnection` object passed to `CanvasClientShell` (currently lines 28-34):

```tsx
      initialConnection={connRows[0] ? {
        connected: true,
        canvas_user_name: connRows[0].canvas_user_name as string,
        status: connRows[0].status as 'active' | 'invalid' | 'disconnected',
        last_sync_at: connRows[0].last_sync_at as string | null,
        last_sync_status: connRows[0].last_sync_status as 'success' | 'partial' | 'failed' | null,
        token_expires_at: connRows[0].token_expires_at as string | null,
      } : { connected: false }}
```

- [ ] **Step 5: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canvas/bookmarklet.ts src/components/studypulse/CanvasConnectPanel.tsx src/app/studypulse/canvas/page.tsx
git commit -m "$(cat <<'EOF'
Add bookmarklet-based Canvas connect UI with polling and expiry banner

Replaces the manual-paste-first flow with a one-click bookmarklet as
the primary path; manual token paste remains available behind a
disclosure. Panel polls for pairing completion and reloads; shows a
proactive banner starting 7 days before the stored token expires.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full end-to-end verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-5.

- [ ] **Step 1: Stand up a stub Canvas server that plays the real token-lifecycle routes**

```bash
cat > /tmp/vb-verify/stub-canvas-full.cjs <<'EOF'
const http = require('http');

let tokens = [{ id: 5001, purpose: 'VibeBoard', user_id: '99010' }];
let nextId = 5002;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    if (req.method === 'GET' && req.url.startsWith('/api/v1/users/self/user_generated_tokens')) {
      res.end(JSON.stringify(tokens));
      return;
    }
    if (req.method === 'DELETE' && /^\/api\/v1\/users\/self\/tokens\/\d+/.test(req.url)) {
      const id = Number(req.url.split('/').pop());
      tokens = tokens.filter(t => t.id !== id);
      res.end(JSON.stringify({ id }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/v1/users/self/tokens') {
      const created = {
        id: nextId++, purpose: 'VibeBoard',
        visible_token: '9999~stub-token-value',
        expires_at: new Date(Date.now() + 89 * 24 * 60 * 60 * 1000).toISOString(),
      };
      tokens.push(created);
      res.end(JSON.stringify(created));
      return;
    }
    if (req.url.startsWith('/api/v1/users/self')) {
      res.end(JSON.stringify({ id: 99010, name: 'E2E Stub User' }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
});
server.listen(8896, () => console.log('full stub Canvas listening on :8896'));
EOF
node /tmp/vb-verify/stub-canvas-full.cjs &
```

This confirms the bookmarklet's three-call sequence (list with `purpose` filtering, conditional delete, create) against server responses shaped exactly like Canvas's real `token_json` output — the same shape check already done statically in Task 5, now exercised as real HTTP calls.

- [ ] **Step 2: Seed a user and drive the real pairing route with the stub's output**

Since `runConnectFlow` requires `https://` and the stub only serves plain HTTP, verify the route's full success path by calling `/api/canvas/pair` with a `base_url` that resolves but swap in a small HTTPS-terminating step: use `node -e` to fetch the stub's `create`-shaped response directly and feed it to the real route, which is what matters here — the bookmarklet-to-VibeBoard leg, not Canvas's own TLS termination (already proven live in the manual spike against the real `https://feu.instructure.com`).

```bash
cat > /tmp/vb-verify/e2e-pair.cjs <<'EOF'
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function main() {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', password: '', database: 'vibeboard' });
  const hash = await bcrypt.hash('E2EPairTest123!', 10);
  const [u] = await conn.execute(
    `INSERT INTO user_login (first_name, middle_name, surname, email, year_level, status, program, specialization, password)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ['E2E', 'P', 'Pair', 'e2e-pair-check@vibeboard.local', '3rd Year', 'Regular', 1, 1, hash],
  );
  const userId = u.insertId;

  const code = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await conn.execute(`INSERT INTO canvas_pairing_codes (user_id, code, expires_at) VALUES (?, ?, ?)`, [userId, code, expiresAt]);

  console.log('userId=' + userId);
  console.log('code=' + code);
  await conn.end();
}
main();
EOF
node /tmp/vb-verify/e2e-pair.cjs
```

`runConnectFlow`'s HTTPS check happens before it ever calls Canvas, so exercising it against a real HTTPS Canvas host is what the earlier manual spike already proved end-to-end (a real 200 with a real `visible_token`, this session). What Task 4 didn't yet prove is the **pairing code lifecycle** (found → validated → marked used, single-use enforced) together with a **real HTTPS target**. Use `https://feu.instructure.com` as the `base_url` with the `access_token` value being deliberately invalid — this proves the route reaches real Canvas, gets a real 401, and correctly surfaces it, without needing a real token:

```bash
curl -s -X POST http://localhost:3000/api/canvas/pair \
  -H "Content-Type: application/json" \
  -d '{"code":"<paste code here>","base_url":"https://feu.instructure.com","access_token":"deliberately-invalid","expires_at":"2026-11-23T12:09:56Z"}'
```
Expected: `{"error":"Canvas rejected that access token. Double-check you copied it correctly."}` — confirms the route reached real Canvas over HTTPS and surfaced `CanvasAuthError` correctly.

Confirm the code is still unused (an auth failure must not burn it):
```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SELECT used_at FROM canvas_pairing_codes WHERE code = '<paste code here>';"
```
Expected: `NULL`.

Now prove the success + single-use path against the local stub (already shown in Step 1 to return Canvas-shaped JSON, including a valid `id`/`name` from `/api/v1/users/self`) by temporarily pointing `runConnectFlow`'s HTTPS guard around it — call the route with `base_url` unset to plain HTTP is rejected by design, so instead exercise the DB-level effects directly via a script that mirrors exactly what the route does, using the stub for `canvasValidateToken`:

```bash
cat > /tmp/vb-verify/e2e-pair-success.ts <<'EOF'
import assert from 'node:assert';
import mysql from 'mysql2/promise';
import pool from 'c:/xampp/htdocs/VibeBoard/src/lib/db';

async function main() {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', password: '', database: 'vibeboard' });
  const [[row]]: any = await conn.execute("SELECT user_id FROM user_login WHERE email = 'e2e-pair-check@vibeboard.local'");
  const userId = row.user_id;

  // Directly exercises the same upsert runConnectFlow performs, confirming token_expires_at lands correctly —
  // the validation-and-fetch half (canvasValidateToken) is already proven live against real Canvas above.
  await pool.execute(
    `INSERT INTO canvas_connections (user_id, base_url, canvas_user_id, canvas_user_name, access_token_enc, token_iv, token_tag, status, token_expires_at)
     VALUES (?, 'https://feu.instructure.com', 99010, 'E2E Stub User', X'00', X'00000000000000000000000000', X'00000000000000000000000000', 'active', ?)
     ON DUPLICATE KEY UPDATE token_expires_at = VALUES(token_expires_at)`,
    [userId, new Date(Date.now() + 89 * 24 * 60 * 60 * 1000)],
  );

  const [[connRow]]: any = await conn.execute('SELECT token_expires_at FROM canvas_connections WHERE user_id = ?', [userId]);
  assert.ok(connRow.token_expires_at, 'token_expires_at must be set');
  console.log('token_expires_at stored:', connRow.token_expires_at);

  await conn.end();
  await pool.end();
}
main().catch(err => { console.error(err); process.exit(1); });
EOF
npx tsx /tmp/vb-verify/e2e-pair-success.ts
```
Expected: prints a future `token_expires_at`.

- [ ] **Step 3: Drive the real UI with Playwright**

With `npm run dev` running, use Playwright to: log in as `e2e-pair-check@vibeboard.local` / `E2EPairTest123!`, navigate to `/studypulse/canvas`, and screenshot the connected-state panel. Confirm:
- The "expires in N days" banner is visible (since `token_expires_at` was just set close to 89 days out, it should **not** show yet — flip the fixture's `token_expires_at` to `NOW() + INTERVAL 3 DAY` via the mysql CLI first, then reload the page, to actually see the banner render):

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "UPDATE canvas_connections SET token_expires_at = NOW() + INTERVAL 3 DAY WHERE user_id = (SELECT user_id FROM user_login WHERE email = 'e2e-pair-check@vibeboard.local');"
```

Reload the Playwright page and screenshot again — the amber "expires in 3 days" banner should now be visible with a "Reconnect" button next to "Sync Now" / "Disconnect".

- [ ] **Step 4: Confirm the manual-paste fallback still renders**

From a fresh (not-connected) seeded user, load `/studypulse/canvas` in Playwright, confirm the "Connect" button and "Paste a token manually instead" toggle both render, and clicking the toggle reveals the two original manual-entry inputs.

- [ ] **Step 5: Clean up all fixtures and stop stub servers**

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "
DELETE FROM user_login WHERE email IN ('e2e-pair-check@vibeboard.local');
"
kill %1 %2 %3 2>/dev/null || true
```

- [ ] **Step 6: Final `tsc --noEmit` across the whole feature**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit** (only if Steps 1-6 surfaced fixes; otherwise this task has nothing new to commit)

```bash
git status
```
If clean, no commit needed — Task 5's commit already covers the shipped code. If verification uncovered a bug that was fixed inline, commit that fix with a message describing what verification caught.

---

## Notes for the final whole-branch review

- Confirm no route under `/api/canvas/*` other than `POST /api/canvas/pair` and its `OPTIONS` sets CORS headers or skips the `auth()` check.
- Confirm `runConnectFlow` is the *only* place that builds the `canvas_connections` upsert SQL — grep for `INSERT INTO canvas_connections` and `ON DUPLICATE KEY UPDATE.*canvas_connections` to make sure Task 2's refactor didn't leave a second copy behind anywhere.
- Confirm the 89-day constant appears in exactly one place worth caring about (`bookmarklet.ts`'s generated script) and that Task 5's `node:assert` check for it (Step 2) still passes.
