import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureCanvasSchema } from '@/lib/migrate';
import { canvasValidateToken } from '@/lib/canvas/client';
import { encryptToken } from '@/lib/canvas/credentials';
import { CanvasAuthError, CanvasApiError } from '@/lib/canvas/errors';

/**
 * The server fetches `{base_url}/api/v1/...` with a user-supplied bearer token and stores the
 * response where the same user can read it back — an SSRF primitive with a readback channel if
 * an internal address is accepted. Block loopback/private/link-local targets. Not intended to
 * be DNS-rebinding-proof (out of scope for this app's threat model); it blocks the obvious
 * internal-network targeting, and the https-only check above stops cleartext token leakage.
 */
function isPrivateHost(hostname: string): boolean {
  // URL() keeps IPv6 literals in brackets; strip them, and normalize case.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '::' || host === '0.0.0.0') return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) — fall through to the IPv4 checks below
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  const ipv4 = v4 ? v4[1] : host;

  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ipv4);
  if (!octets) return false;
  const [a, b] = [Number(octets[1]), Number(octets[2])];
  if (a === 127 || a === 10 || a === 0) return true;            // loopback, private, "this host"
  if (a === 192 && b === 168) return true;                       // private
  if (a === 172 && b >= 16 && b <= 31) return true;              // private
  if (a === 169 && b === 254) return true;                       // link-local (incl. cloud metadata)
  return false;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCanvasSchema();

  const { base_url, access_token } = await req.json();
  if (!base_url || !access_token) {
    return Response.json({ error: 'base_url and access_token are required' }, { status: 400 });
  }

  const cleanBaseUrl = String(base_url).trim().replace(/\/$/, '');

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cleanBaseUrl);
  } catch {
    return Response.json({ error: 'base_url must be a valid URL, e.g. https://yourschool.instructure.com' }, { status: 400 });
  }
  if (parsedUrl.protocol !== 'https:') {
    return Response.json({ error: 'base_url must start with https:// — a Canvas access token must never be sent over plain http.' }, { status: 400 });
  }
  if (isPrivateHost(parsedUrl.hostname)) {
    return Response.json({ error: 'base_url must be a public Canvas host, e.g. https://yourschool.instructure.com' }, { status: 400 });
  }

  let canvasUser: { id: number; name: string };
  try {
    canvasUser = await canvasValidateToken(cleanBaseUrl, access_token);
  } catch (err) {
    if (err instanceof CanvasAuthError) {
      return Response.json({ error: 'Canvas rejected that access token. Double-check you copied it correctly.' }, { status: 400 });
    }
    if (err instanceof CanvasApiError) {
      return Response.json({ error: `Could not reach Canvas at ${cleanBaseUrl}. Check the domain is correct.` }, { status: 400 });
    }
    // Handle network-level fetch failures (DNS, connection refusal, malformed URL, etc.)
    return Response.json({ error: `Could not reach Canvas at ${cleanBaseUrl}. Check the domain is correct.` }, { status: 400 });
  }

  const { enc, iv, tag } = encryptToken(access_token);
  const userId = parseInt(session.user.id);

  await pool.execute(
    `INSERT INTO canvas_connections
       (user_id, base_url, canvas_user_id, canvas_user_name, access_token_enc, token_iv, token_tag, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
     ON DUPLICATE KEY UPDATE
       base_url = VALUES(base_url), canvas_user_id = VALUES(canvas_user_id),
       canvas_user_name = VALUES(canvas_user_name), access_token_enc = VALUES(access_token_enc),
       token_iv = VALUES(token_iv), token_tag = VALUES(token_tag), status = 'active', last_error = NULL`,
    [userId, cleanBaseUrl, canvasUser.id, canvasUser.name, enc, iv, tag],
  );

  return Response.json({ status: 'success', canvas_user_name: canvasUser.name });
}
