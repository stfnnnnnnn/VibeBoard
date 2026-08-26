# Canvas Access Token Pairing (Bookmarklet) — Design

**Status:** Approved for planning
**Date:** 2026-08-26
**Depends on:** the existing Canvas Sync feature (`docs/superpowers/specs/2026-08-20-canvas-sync-design.md`) and its manual-token connect flow (`src/app/api/canvas/connect/route.ts`, `src/lib/canvas/credentials.ts`).

## Problem

Connecting VibeBoard to Canvas today requires the student to manually navigate Canvas's Settings page, click "New Access Token," copy the raw token value, and paste it into VibeBoard. This is unfamiliar, easy to get wrong (wrong field, truncated paste), and has to be repeated every time the token expires.

There is no OAuth2 Developer Key available for this school's Canvas instance (`feu.instructure.com`), so the standard "log in via Canvas, get redirected back automatically" pattern is not available — Canvas would need to opt into that handshake on its end, and it hasn't.

A feasibility spike (this session, informal — see conversation history, not a committed doc) proved that a script running inside the user's own already-authenticated Canvas browser tab can call Canvas's real `POST /api/v1/users/self/tokens` endpoint successfully, using headers reverse-engineered from Canvas's own open-source frontend (`@instructure/platform-get-cookie`'s `decodeURIComponent`-decoded `_csrf_token` cookie + `X-Requested-With: XMLHttpRequest` + Canvas's `Accept` header). This design turns that spike into a real, low-friction feature.

## Goals

- Let the student connect Canvas with a single click on a bookmarklet, instead of manually copying a token.
- Never have VibeBoard touch, request, or see the student's Canvas password — only the resulting API token, exactly as today's manual flow already handles it.
- Reuse the existing encrypted-at-rest token storage (`canvas_connections`) and validation logic (`canvasValidateToken`, SSRF guard) rather than building a parallel path.
- Keep the student's Canvas "Approved Integrations" list tidy — reconnecting shouldn't pile up old VibeBoard token entries.
- Warn the student proactively, a few days before the token expires, rather than only after sync starts failing.

## Non-goals (out of scope for this iteration)

- No browser extension. A true zero-click, auto-running-on-page-load flow would need one, but that's a much heavier build (packaging, permissions, store review or manual sideloading) for a token that only needs renewing every ~89 days. Explicitly deferred.
- No support for a typed/pasted pairing code (Approach B considered and rejected) — the code is embedded directly in a freshly-generated bookmarklet each time instead.
- No mobile-specific flow. Bookmarklets are desktop-browser-oriented; mobile is not a target for this iteration.
- No change to how the *manual* paste flow works — it remains available as a fallback and continues to function exactly as today.

## Data model

One new table, created via `ensureCanvasSchema()` in `src/lib/migrate.ts` (same idempotent pattern already used there):

```sql
CREATE TABLE IF NOT EXISTS canvas_pairing_codes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  code        CHAR(43) NOT NULL,   -- 32 random bytes, base64url-encoded
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_code (code),
  FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
);
```

One new column on the existing `canvas_connections` table:

```sql
ALTER TABLE canvas_connections ADD COLUMN token_expires_at DATETIME NULL AFTER last_error;
```

`token_expires_at` is populated only by the pairing flow (Canvas tells us the expiry at creation time); the manual paste flow leaves it `NULL` since it has no way to know the value, and those connections keep only the existing reactive "invalid, reconnect" banner.

## Components

- **`src/lib/canvas/connectFlow.ts`** (new, extracted) — the HTTPS-only check, `isPrivateHost` SSRF guard, `canvasValidateToken` call, `encryptToken`, and `canvas_connections` upsert, currently inline in `connect/route.ts`. Both the manual route and the new pairing route call this, so the two paths can't drift apart on validation.
- **`POST /api/canvas/pair/start`** (new) — authenticated (normal VibeBoard session, same as every other `/api/canvas/*` route). Generates a pairing code, inserts it with a 10-minute expiry, returns `{ code, expires_at }`.
- **`GET /api/canvas/pair/start?code=...`** (new, same route file) — status check for polling: returns `{ used: boolean, canvas_user_name? }`. Requires the same VibeBoard session and that the code belongs to the requesting user (not just knowledge of the code), since this one doesn't need to be reachable from Canvas's origin.
- **`POST /api/canvas/pair`** (new) — the only unauthenticated, CORS-open (`Access-Control-Allow-Origin: *`) route under `/api/canvas/*`. Body: `{ code, base_url, access_token, expires_at }`. Looks up the code (must exist, unused, unexpired), calls `connectFlow` for validation/storage, stores `token_expires_at`, marks the code used.
- **`CanvasConnectPanel.tsx`** (modified) — replace the "paste a token" form with: a "Connect Canvas" button that calls `pair/start`, renders a draggable bookmarklet link + instructions, and polls the status endpoint every 3s (stopping after 10 minutes) to auto-refresh via the existing `onChange` prop when the code is used. Adds a new expiry-warning banner (see below). The manual-paste form moves behind a "paste a token manually instead" disclosure, kept as a fallback.
- **The bookmarklet script itself** — see Data Flow below for full content.

## Data flow

**Setup (once per connect/reconnect):**
1. Student clicks "Connect Canvas" on VibeBoard's Canvas panel.
2. Panel calls `POST /api/canvas/pair/start` → gets `{ code, expires_at }`.
3. Panel renders a draggable bookmarklet link built client-side from a template, with `code` and VibeBoard's own origin substituted in. Instructions: "Drag this to your bookmarks bar, then go to your Canvas site and click it. Expires in 10 minutes."
4. Panel polls `GET /api/canvas/pair/start?code=...` every 3s; on `used: true`, calls `onChange()` (existing refresh prop) automatically.

**Execution (in the Canvas tab, when the bookmarklet is clicked):**

```js
javascript:(function(){
  const CODE = "<embedded pairing code>";
  const VIBEBOARD_ORIGIN = "<embedded origin>";

  (async () => {
    try {
      const raw = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/)?.[1];
      const csrf = raw ? decodeURIComponent(raw) : '';
      const headers = {
        'Accept': 'application/json+canvas-string-ids, application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      };

      // 1. Clean up any previous VibeBoard token so Approved Integrations doesn't pile up
      const listRes = await fetch('/api/v1/users/self/tokens', { credentials: 'same-origin', headers });
      const existing = await listRes.json();
      const old = Array.isArray(existing) ? existing.find(t => t.purpose === 'VibeBoard') : null;
      if (old) {
        await fetch(`/api/v1/users/self/tokens/${old.id}`, { method: 'DELETE', credentials: 'same-origin', headers });
      }

      // 2. Create a fresh token, capped just under Canvas's 90-day maximum
      const createRes = await fetch('/api/v1/users/self/tokens', {
        method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify({ token: {
          purpose: 'VibeBoard',
          expires_at: new Date(Date.now() + 89 * 24 * 60 * 60 * 1000).toISOString(),
        }}),
      });
      if (!createRes.ok) throw new Error('Canvas rejected the token request (status ' + createRes.status + ')');
      const created = await createRes.json();

      // 3. Hand it to VibeBoard
      const pairRes = await fetch(VIBEBOARD_ORIGIN + '/api/canvas/pair', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: CODE, base_url: location.origin,
          access_token: created.visible_token, expires_at: created.expires_at,
        }),
      });
      const pairData = await pairRes.json();
      if (!pairRes.ok) throw new Error(pairData.error || 'VibeBoard rejected the token');

      alert('Connected VibeBoard to Canvas as ' + pairData.canvas_user_name + '. You can close this tab and go back to VibeBoard.');
    } catch (err) {
      alert('VibeBoard connect failed: ' + err.message + '\n\nGo back to VibeBoard and try again.');
    }
  })();
})();
```

Before implementation, verify the real shape of the `user_generated_tokens` list route's response (confirmed to exist in Canvas's `routes.rb` during the spike, but never actually exercised — only `create` was) — the `existing.find(t => t.purpose === 'VibeBoard')` line above assumes a flat array of token objects with a `purpose` field, matching the shape `create` returns, but that should be confirmed against a real response rather than assumed.

**Server side (`POST /api/canvas/pair`):**
1. Look up `code` in `canvas_pairing_codes` → 400 if missing, expired, or already `used_at`.
2. `connectFlow`: HTTPS-only + `isPrivateHost` guard on `base_url`, `canvasValidateToken(base_url, access_token)` to confirm the token works and get `canvas_user_id`/`canvas_user_name`, `encryptToken`, upsert into `canvas_connections` (same `ON DUPLICATE KEY UPDATE` as the manual route) — now also setting `token_expires_at` from the request body.
3. Mark the pairing code used: `UPDATE canvas_pairing_codes SET used_at = NOW() WHERE code = ? AND used_at IS NULL` (single atomic statement, so a race between the status-poll and the real pairing request can't double-consume it).
4. Respond `{ status: 'success', canvas_user_name }`.

## Proactive expiry warning

`CanvasConnectPanel` shows a persistent (non-blocking, dismissible-per-session) banner when: connection `status === 'active'`, `token_expires_at` is not null, and `token_expires_at` is within 7 days of now. Text: "Your Canvas connection expires in N days — reconnect anytime to renew it," with a "Reconnect" button that runs the same bookmarklet-generation flow as initial connect. This requires plumbing `token_expires_at` through the `ConnectionStatus` interface and the `SELECT` in `src/app/studypulse/canvas/page.tsx`.

Connections from the manual-paste flow (`token_expires_at IS NULL`) don't get this banner — they keep only the existing reactive "invalid, reconnect" banner that fires once a sync actually fails.

## Security

- Pairing code: 32 random bytes (`crypto.randomBytes`), base64url — effectively unguessable within its 10-minute window; single-use, enforced atomically as above.
- `/api/canvas/pair` is the only unauthenticated, CORS-open route under `/api/canvas/*` — every other route keeps requiring a VibeBoard session, including the new `pair/start` (both POST and its GET status-check variant).
- `/api/canvas/pair` never trusts `base_url`/`access_token` blindly: same HTTPS-only + `isPrivateHost` SSRF guard as the manual flow (via the shared `connectFlow` helper), plus `canvasValidateToken` actually round-trips to Canvas before anything is stored.
- The raw Canvas token is never displayed to the user or logged anywhere server-side — same encrypted-at-rest handling (`src/lib/canvas/credentials.ts`) as the existing manual flow.
- The bookmarklet's source is visible to anyone who inspects it — expected and fine, since the only secret it embeds (the pairing code) is single-use and short-lived, not a durable credential. Unlike Approach B (a permanent, code-free bookmarklet), nothing long-lived sits in the browser's bookmarks bar.

## Error handling

- Bookmarklet: every failure path (Canvas 401/400/network error, VibeBoard rejecting the code) ends in a single `alert()` with a plain-language message — no silent failures.
- `/api/canvas/pair`: expired/missing/already-used code → 400 with a message the bookmarklet surfaces directly; Canvas validation failure → the same error messages the manual route already produces (via the shared helper).
- Status-polling on VibeBoard's side stops after the same 10-minute window elapses, so a tab left open doesn't poll forever.

## Testing

Playwright E2E, matching this session's established pattern (seed fixtures via mysql2/bcryptjs, drive real requests, clean up via SQL DELETE): seed a VibeBoard user, call `/api/canvas/pair/start` to get a real code, simulate the "Canvas-side" POST directly against `/api/canvas/pair` (a real Canvas can't be scripted in tests, so this boundary is stubbed at the HTTP level), assert the `canvas_connections` row is written correctly and the code is marked used. Unit tests for `connectFlow`'s validation branches (bad code, expired code, reused code, non-HTTPS `base_url`, private-host `base_url`) and for the atomic used-code race guard.
