/** Overall GPA across a user's subjects (moved verbatim from the stats route so the dashboard can reuse it). Server-only. */
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { convertToGPA } from './gpaScale';

/* Weighted period grade for a subject set up via the custom Grading Setup
   Wizard — mirrors CustomGradeCalculator in SubjectCardView.tsx, including
   treating a category with zero entries as perfect (100) rather than 0, so
   it doesn't drag the grade down before any work has been submitted for it.
   Returns null if the subject isn't custom-graded, has no period matching
   namePattern, or has no entries anywhere in that period yet. */
export async function getCustomPeriodGrade(userSubjectId: number, namePattern: RegExp): Promise<number | null> {
  const [sgRows] = await pool.execute<RowDataPacket[]>(
    'SELECT preset_id FROM subject_grading WHERE user_subject_id = ?', [userSubjectId]
  );
  if (!sgRows.length) return null;
  const presetId = sgRows[0].preset_id;

  const [periods] = await pool.execute<RowDataPacket[]>(
    'SELECT period_id, name FROM grading_periods WHERE preset_id = ?', [presetId]
  );
  const period = periods.find(p => namePattern.test(String(p.name)));
  if (!period) return null;

  const [cats] = await pool.execute<RowDataPacket[]>(
    'SELECT cat_id, weight FROM grading_categories WHERE period_id = ?', [period.period_id]
  );
  if (!cats.length) return null;

  const [entries] = await pool.execute<RowDataPacket[]>(
    'SELECT cat_id, score, items, grade FROM grade_entries WHERE user_subject_id = ? AND period_id = ?',
    [userSubjectId, period.period_id]
  );

  let weightedSum = 0, totalWeight = 0, anyData = false;
  for (const cat of cats) {
    const rows   = entries.filter(e => Number(e.cat_id) === Number(cat.cat_id));
    const graded = rows.filter(r => r.grade !== null || (r.score !== null && r.items !== null));
    const hasData = graded.length > 0;
    if (hasData) anyData = true;

    const avg = hasData
      ? graded.reduce((s, r) => {
          const g = r.grade !== null ? Number(r.grade) : (Number(r.score) / Number(r.items)) * 100;
          return s + g;
        }, 0) / graded.length
      : 100;

    weightedSum += avg * Number(cat.weight);
    totalWeight += Number(cat.weight);
  }

  if (!anyData || totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

export async function getOverallGPA(userId: number, term: 'midterm' | 'final'): Promise<number> {
  const [subjects] = await pool.execute<RowDataPacket[]>(
    'SELECT user_subject_id FROM user_subjects WHERE user_id = ?',
    [userId]
  );

  const gpas: number[] = [];

  for (const sub of subjects) {
    const sid = sub.user_subject_id;

    try {
      const pattern     = term === 'midterm' ? /mid/i : /final/i;
      const customGrade = await getCustomPeriodGrade(sid, pattern);
      if (customGrade !== null) {
        gpas.push(convertToGPA(customGrade));
        continue;
      }
    } catch {
      // grading tables not yet created — fall through to legacy
    }

    const avg = (rows: RowDataPacket[]) =>
      rows.length ? rows.reduce((s, r) => s + Number(r.grade), 0) / rows.length : null;

    const [qR] = await pool.execute<RowDataPacket[]>(
      'SELECT grade FROM quizzes WHERE user_subject_id = ? AND grade IS NOT NULL', [sid]);
    const [aR] = await pool.execute<RowDataPacket[]>(
      'SELECT grade FROM activities WHERE user_subject_id = ? AND grade IS NOT NULL', [sid]);
    const [mR] = await pool.execute<RowDataPacket[]>(
      "SELECT grade FROM exams WHERE user_subject_id = ? AND LOWER(exam_type) = 'midterm' AND grade IS NOT NULL", [sid]);
    const [fR] = await pool.execute<RowDataPacket[]>(
      "SELECT grade FROM exams WHERE user_subject_id = ? AND LOWER(exam_type) = 'final exam' AND grade IS NOT NULL", [sid]);

    const qAvg = avg(qR), aAvg = avg(aR), mid = avg(mR), fin = avg(fR);

    let weightedSum = 0, totalWeight = 0;
    if (aAvg !== null) { weightedSum += aAvg * 24; totalWeight += 24; }
    if (qAvg !== null) { weightedSum += qAvg * 36; totalWeight += 36; }
    if (term === 'midterm') {
      if (mid !== null) { weightedSum += mid * 40; totalWeight += 40; }
    } else {
      if (mid !== null) { weightedSum += mid * 15; totalWeight += 15; }
      if (fin !== null) { weightedSum += fin * 25; totalWeight += 25; }
    }

    if (totalWeight === 0) continue;
    gpas.push(convertToGPA(weightedSum / totalWeight));
  }

  if (!gpas.length) return 0;
  return Math.round((gpas.reduce((a, b) => a + b, 0) / gpas.length) * 100) / 100;
}
