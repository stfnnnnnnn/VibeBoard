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
