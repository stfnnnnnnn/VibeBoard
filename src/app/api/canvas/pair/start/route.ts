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
