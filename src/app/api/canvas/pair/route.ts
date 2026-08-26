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
