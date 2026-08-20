import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const status = req.nextUrl.searchParams.get('status') ?? 'pending';

  // A bank item's mapped subject is in "custom" mode when it has a subject_grading row
  // pointing at a real grading preset — the same condition src/app/studypulse/[id]/page.tsx
  // uses to decide whether to render the legacy activities/quizzes/exams tables at all.
  // Items on a custom-mode subject can't be Included through the legacy path (the inserted
  // row would never be displayed), so the client needs to know which mode each item is in.
  const SELECT_WITH_MODE = `
    SELECT bank.*, cc.name AS course_name, cc.user_subject_id,
           CASE WHEN gp.preset_id IS NOT NULL THEN 'custom' ELSE 'legacy' END AS subject_mode
     FROM canvas_activity_bank bank
     JOIN canvas_courses cc ON cc.id = bank.course_id
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     LEFT JOIN subject_grading sg ON sg.user_subject_id = cc.user_subject_id
     LEFT JOIN grading_presets gp ON gp.preset_id = sg.preset_id
     WHERE conn.user_id = ? AND bank.bank_status = ?
     ORDER BY bank.due_at IS NULL, bank.due_at ASC`;

  const SELECT_LEGACY_ONLY = `
    SELECT bank.*, cc.name AS course_name, cc.user_subject_id, 'legacy' AS subject_mode
     FROM canvas_activity_bank bank
     JOIN canvas_courses cc ON cc.id = bank.course_id
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     WHERE conn.user_id = ? AND bank.bank_status = ?
     ORDER BY bank.due_at IS NULL, bank.due_at ASC`;

  let rows: RowDataPacket[];
  try {
    [rows] = await pool.execute<RowDataPacket[]>(SELECT_WITH_MODE, [userId, status]);
  } catch (err) {
    // grading tables not yet created on this database — every subject is legacy-mode.
    console.error('Canvas bank: grading-mode join failed, falling back to legacy mode:', err);
    [rows] = await pool.execute<RowDataPacket[]>(SELECT_LEGACY_ONLY, [userId, status]);
  }
  return Response.json({ items: rows });
}
