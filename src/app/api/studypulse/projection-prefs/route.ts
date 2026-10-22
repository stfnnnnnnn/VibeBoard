import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureProjectionPrefsSchema } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';
import { parsePrefKey, clampPrefValue, rowsToPrefs } from '@/lib/studypulse/prefs';

async function ownsSubject(userId: number, userSubjectId: number): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM user_subjects WHERE user_subject_id=? AND user_id=?', [userSubjectId, userId],
  );
  return rows.length > 0;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userSubjectId = Number(req.nextUrl.searchParams.get('user_subject_id'));
  if (!Number.isInteger(userSubjectId) || userSubjectId <= 0) return Response.json({ error: 'user_subject_id required' }, { status: 400 });
  if (!(await ownsSubject(parseInt(session.user.id), userSubjectId))) return Response.json({ error: 'Not found' }, { status: 404 });

  await ensureProjectionPrefsSchema();
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT pref_key, value FROM studypulse_projection_prefs WHERE user_subject_id=?', [userSubjectId],
  );
  return Response.json(rowsToPrefs(rows.map(r => ({ key: String(r.pref_key), value: Number(r.value) }))));
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as { user_subject_id?: unknown; key?: unknown; value?: unknown } | null;
  const userSubjectId = Number(body?.user_subject_id);
  const parsed = parsePrefKey(body?.key);
  if (!Number.isInteger(userSubjectId) || userSubjectId <= 0 || !parsed) return Response.json({ error: 'Invalid key' }, { status: 400 });
  const value = clampPrefValue(parsed.kind, Number(body?.value));
  if (value === null) return Response.json({ error: 'Invalid value' }, { status: 400 });
  if (!(await ownsSubject(parseInt(session.user.id), userSubjectId))) return Response.json({ error: 'Not found' }, { status: 404 });

  await ensureProjectionPrefsSchema();
  await pool.execute(
    `INSERT INTO studypulse_projection_prefs (user_subject_id, pref_key, value) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE value=VALUES(value)`,
    [userSubjectId, body!.key as string, value],
  );
  return Response.json({ status: 'success', key: body!.key, value });
}
