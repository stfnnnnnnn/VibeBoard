import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import {
  suggestLegacyCategory, suggestCustomCategory, classificationText, suggestDestinations,
  stripHtml, extractAnnouncementNote, noteSpans,
  type SuggestedCategory, type WorkboardDestination,
} from '@/lib/canvas/classify';
import { ensureGradingV2Schema } from '@/lib/migrate';

const STATUSES = ['pending', 'included', 'ignored'] as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Guarantees canvas_announcement_bank.seen_at exists (returned through bank.*).
  await ensureGradingV2Schema();

  const userId = parseInt(session.user.id);
  const status = req.nextUrl.searchParams.get('status') ?? 'pending';
  if (!(STATUSES as readonly string[]).includes(status)) {
    return Response.json({ error: 'Invalid status' }, { status: 400 });
  }
  const userSubjectIdParam = req.nextUrl.searchParams.get('user_subject_id');
  const userSubjectId = userSubjectIdParam !== null ? parseInt(userSubjectIdParam) : null;

  // Same grading-mode join (and same graceful fallback if the grading tables don't exist)
  // as GET /api/canvas/bank, and the same `status` filter (pending | included | ignored,
  // default pending).
  const SELECT_WITH_MODE = `
    SELECT bank.*, cc.name AS course_name, cc.user_subject_id,
           CASE WHEN gp.preset_id IS NOT NULL THEN 'custom' ELSE 'legacy' END AS subject_mode
     FROM canvas_announcement_bank bank
     JOIN canvas_courses cc ON cc.id = bank.course_id
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     LEFT JOIN subject_grading sg ON sg.user_subject_id = cc.user_subject_id
     LEFT JOIN grading_presets gp ON gp.preset_id = sg.preset_id
     WHERE conn.user_id = ? AND bank.bank_status = ?${userSubjectId !== null ? ' AND cc.user_subject_id = ?' : ''}
     ORDER BY bank.posted_at IS NULL, bank.posted_at DESC`;

  const SELECT_LEGACY_ONLY = `
    SELECT bank.*, cc.name AS course_name, cc.user_subject_id, 'legacy' AS subject_mode
     FROM canvas_announcement_bank bank
     JOIN canvas_courses cc ON cc.id = bank.course_id
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     WHERE conn.user_id = ? AND bank.bank_status = ?${userSubjectId !== null ? ' AND cc.user_subject_id = ?' : ''}
     ORDER BY bank.posted_at IS NULL, bank.posted_at DESC`;

  const params = userSubjectId !== null ? [userId, status, userSubjectId] : [userId, status];

  let rows: RowDataPacket[];
  try {
    [rows] = await pool.execute<RowDataPacket[]>(SELECT_WITH_MODE, params);
  } catch (err) {
    console.error('Canvas announcements: grading-mode join failed, falling back to legacy mode:', err);
    [rows] = await pool.execute<RowDataPacket[]>(SELECT_LEGACY_ONLY, params);
  }

  // Fetch each distinct custom-mode subject's category names once (not per row) to avoid N+1.
  const customSubjectIds = [...new Set(
    rows
      .filter(r => r.subject_mode === 'custom' && r.user_subject_id)
      .map(r => r.user_subject_id as number),
  )];
  const categoriesBySubject = new Map<number, string[]>();
  for (const sid of customSubjectIds) {
    const [cats] = await pool.execute<RowDataPacket[]>(
      `SELECT gc.name FROM grading_categories gc
       JOIN grading_periods gp ON gp.period_id = gc.period_id
       JOIN subject_grading sg ON sg.preset_id = gp.preset_id
       WHERE sg.user_subject_id = ?
       ORDER BY gp.period_id, gc.sort_order`,
      [sid],
    );
    categoriesBySubject.set(sid, cats.map(c => c.name as string));
  }

  const items = rows.map(row => {
    const text = classificationText(row.title as string, row.message as string | null);
    let suggested: SuggestedCategory;
    if (row.subject_mode === 'custom' && row.user_subject_id) {
      const names = categoriesBySubject.get(row.user_subject_id as number) ?? [];
      const match = suggestCustomCategory(text, names);
      suggested = match ? { kind: 'custom', categoryName: match } : { kind: 'general' };
    } else {
      const target = suggestLegacyCategory(text);
      suggested = target === 'general' ? { kind: 'general' } : { kind: 'legacy', target };
    }
    const destinations: WorkboardDestination[] = [...suggestDestinations(text, suggested.kind !== 'general')];
    // Spec §6.1: the extra-detail sentences, computed from the same stripped body the client
    // shows, so `note_spans` index into stripHtml(message).
    const body = stripHtml(row.message as string | null);
    return {
      ...row, suggested_category: suggested, suggested_destinations: destinations,
      suggested_note: extractAnnouncementNote(body), note_spans: noteSpans(body),
    };
  });

  return Response.json({ items });
}
