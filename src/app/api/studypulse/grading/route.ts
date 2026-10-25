import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureGradeScale, ensureFinalGrade, ensureCategoryLinking, ensureGradingV2Schema } from '@/lib/migrate';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { resolveFinal, validateDraft } from '@/lib/studypulse/presetDiff';

/* GET  /api/studypulse/grading  — list all presets for user */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureGradingV2Schema();
  const userId = parseInt(session.user.id);

  const [presets] = await pool.execute<RowDataPacket[]>(
    `SELECT p.preset_id, p.name, p.is_default, p.has_lab, p.lec_weight, p.lab_weight,
            COUNT(DISTINCT gp.period_id) AS period_count
     FROM grading_presets p
     LEFT JOIN grading_periods gp ON gp.preset_id = p.preset_id
     WHERE p.user_id = ?
     GROUP BY p.preset_id
     ORDER BY p.is_default DESC, p.created_at ASC`,
    [userId]
  );
  return Response.json({ presets });
}

/* POST /api/studypulse/grading  — create full preset (with periods + categories) */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureGradingV2Schema();
  const userId = parseInt(session.user.id);

  const {
    name, is_default, has_lab, lec_weight, lab_weight, grade_scale, periods,
    final_period_index, final_mode,
  } = await req.json();

  // The same whole-draft check PUT runs (names, weights summing to 100, one category per linked group).
  const draftError = validateDraft(name, periods);
  if (draftError) return Response.json({ error: draftError }, { status: 400 });
  // final_mode is 'period' | 'average' (a stored legacy 'collective' still maps to 'average');
  // final_period_index picks the period for either mode. Checked up front with placeholder ids.
  const finalCheck = resolveFinal(final_mode ?? null, null, final_period_index, null, periods.map((_: unknown, i: number) => i + 1));
  if ('error' in finalCheck) return Response.json({ error: finalCheck.error }, { status: 400 });

  await ensureGradeScale();
  await ensureFinalGrade();
  await ensureCategoryLinking();

  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (is_default) {
      await conn.execute('UPDATE grading_presets SET is_default=0 WHERE user_id=?', [userId]);
    }

    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO grading_presets (user_id, name, is_default, has_lab, lec_weight, lab_weight, grade_scale)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, String(name).trim(), is_default ? 1 : 0, has_lab ? 1 : 0,
       lec_weight ?? 100, lab_weight ?? 0, grade_scale ?? '4pt']
    );
    const presetId = result.insertId;

    const periodIds: number[] = [];
    for (let pi = 0; pi < periods.length; pi++) {
      const period = periods[pi];
      const [pr] = await conn.execute<ResultSetHeader>(
        `INSERT INTO grading_periods (preset_id, name, sort_order) VALUES (?, ?, ?)`,
        [presetId, period.name, pi]
      );
      const periodId = pr.insertId;
      periodIds.push(periodId);

      for (let ci = 0; ci < (period.categories ?? []).length; ci++) {
        const cat = period.categories[ci];
        await conn.execute(
          `INSERT INTO grading_categories (period_id, name, weight, is_singleton, sort_order, link_group, carry_score, include_earlier)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [periodId, cat.name, cat.weight, cat.is_singleton ? 1 : 0, ci,
           cat.link_group ?? null, cat.carry_score === false ? 0 : 1, cat.include_earlier ? 1 : 0]
        );
      }
    }

    const fin = resolveFinal(final_mode ?? null, null, final_period_index, null, periodIds);
    if (!('error' in fin) && fin.final_mode !== null) {
      await conn.execute(
        `UPDATE grading_presets SET final_period_id=?, final_mode=? WHERE preset_id=?`,
        [fin.final_period_id, fin.final_mode, presetId]
      );
    }

    await conn.commit();
    return Response.json({ status: 'success', preset_id: presetId });
  } catch (err) {
    await conn.rollback();
    // The full error stays in the server log; the client gets a generic message (no DB text).
    console.error('Create grading system failed:', err);
    return Response.json({ error: 'Could not create the grading system. Try again.' }, { status: 500 });
  } finally {
    conn.release();
  }
}
