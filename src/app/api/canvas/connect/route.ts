import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureCanvasSchema } from '@/lib/migrate';
import { canvasValidateToken } from '@/lib/canvas/client';
import { encryptToken } from '@/lib/canvas/credentials';
import { CanvasAuthError, CanvasApiError } from '@/lib/canvas/errors';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCanvasSchema();

  const { base_url, access_token } = await req.json();
  if (!base_url || !access_token) {
    return Response.json({ error: 'base_url and access_token are required' }, { status: 400 });
  }

  const cleanBaseUrl = String(base_url).trim().replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9.-]+\.instructure\.com$/i.test(cleanBaseUrl) && !/^https?:\/\//.test(cleanBaseUrl)) {
    return Response.json({ error: 'base_url must be a valid URL, e.g. https://yourschool.instructure.com' }, { status: 400 });
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
    throw err;
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
