import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { getOverallGPA } from '@/lib/studypulse/gpaSummary';

type LegacyTable = 'activities' | 'quizzes' | 'exams';

/* Custom Grading Setup Wizard categories are freeform text (e.g. "Tasks",
   "Quizzes", "Midterm Exam"), so folding them into the legacy Activity/Quiz/Exam
   buckets is a best-effort keyword match, not an exact mapping. Categories that
   don't match any keyword simply don't count toward these three bars. */
const CATEGORY_KEYWORDS: Record<LegacyTable, string[]> = {
  activities: ['activ', 'task'],
  quizzes:    ['quiz'],
  exams:      ['exam'],
};

function likeClause(col: string, keywords: string[]): { sql: string; params: string[] } {
  return {
    sql:    '(' + keywords.map(() => `LOWER(${col}) LIKE ?`).join(' OR ') + ')',
    params: keywords.map(k => `%${k}%`),
  };
}

async function getTotal(userId: number, table: LegacyTable, status?: string, urgency?: string): Promise<number> {
  let query = `SELECT COUNT(*) as count FROM ${table} qt
               INNER JOIN user_subjects us ON qt.user_subject_id = us.user_subject_id
               WHERE us.user_id = ?`;
  const params: (number | string)[] = [userId];
  if (status)  { query += ' AND qt.status = ?';  params.push(status); }
  if (urgency) { query += ' AND qt.urgency = ?'; params.push(urgency); }
  const [rows] = await pool.execute<RowDataPacket[]>(query, params);
  let count = Number(rows[0].count);

  try {
    const { sql: likeSql, params: likeParams } = likeClause('gc.name', CATEGORY_KEYWORDS[table]);
    let geQuery = `SELECT COUNT(*) as count FROM grade_entries ge
                   INNER JOIN user_subjects us ON ge.user_subject_id = us.user_subject_id
                   INNER JOIN grading_categories gc ON ge.cat_id = gc.cat_id
                   WHERE us.user_id = ? AND ${likeSql}`;
    const geParams: (number | string)[] = [userId, ...likeParams];
    if (status)  { geQuery += ' AND ge.status = ?';  geParams.push(status); }
    if (urgency) { geQuery += ' AND ge.urgency = ?'; geParams.push(urgency); }
    const [geRows] = await pool.execute<RowDataPacket[]>(geQuery, geParams);
    count += Number(geRows[0].count ?? 0);
  } catch {
    // grading tables not yet created
  }

  return count;
}

async function getAvgGrade(userId: number, table: LegacyTable): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT grade FROM ${table} qt
     INNER JOIN user_subjects us ON qt.user_subject_id = us.user_subject_id
     WHERE us.user_id = ? AND qt.grade IS NOT NULL`,
    [userId]
  );
  const grades = rows.map(r => Number(r.grade));

  try {
    const { sql: likeSql, params: likeParams } = likeClause('gc.name', CATEGORY_KEYWORDS[table]);
    const [geRows] = await pool.execute<RowDataPacket[]>(
      `SELECT ge.grade FROM grade_entries ge
       INNER JOIN user_subjects us ON ge.user_subject_id = us.user_subject_id
       INNER JOIN grading_categories gc ON ge.cat_id = gc.cat_id
       WHERE us.user_id = ? AND ge.grade IS NOT NULL AND ${likeSql}`,
      [userId, ...likeParams]
    );
    grades.push(...geRows.map(r => Number(r.grade)));
  } catch {
    // grading tables not yet created
  }

  if (!grades.length) return 0;
  return Math.round((grades.reduce((a, b) => a + b, 0) / grades.length) * 10) / 10;
}

async function getCompletion(userId: number, table: LegacyTable): Promise<{ pct: number; avgGrade: number }> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN qt.status = 'Done' THEN 1 ELSE 0 END) AS completed
     FROM ${table} qt
     INNER JOIN user_subjects us ON qt.user_subject_id = us.user_subject_id
     WHERE us.user_id = ?`,
    [userId]
  );
  let total     = Number(rows[0].total ?? 0);
  let completed = Number(rows[0].completed ?? 0);

  const [gRows] = await pool.execute<RowDataPacket[]>(
    `SELECT qt.grade FROM ${table} qt
     INNER JOIN user_subjects us ON qt.user_subject_id = us.user_subject_id
     WHERE us.user_id = ? AND qt.status = 'Done' AND qt.grade IS NOT NULL`,
    [userId]
  );
  const doneGrades = gRows.map(r => Number(r.grade));

  try {
    const { sql: likeSql, params: likeParams } = likeClause('gc.name', CATEGORY_KEYWORDS[table]);
    const [geRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ge.status = 'Done' THEN 1 ELSE 0 END) AS completed
       FROM grade_entries ge
       INNER JOIN user_subjects us ON ge.user_subject_id = us.user_subject_id
       INNER JOIN grading_categories gc ON ge.cat_id = gc.cat_id
       WHERE us.user_id = ? AND ${likeSql}`,
      [userId, ...likeParams]
    );
    total     += Number(geRows[0].total ?? 0);
    completed += Number(geRows[0].completed ?? 0);

    const [geGradeRows] = await pool.execute<RowDataPacket[]>(
      `SELECT ge.grade FROM grade_entries ge
       INNER JOIN user_subjects us ON ge.user_subject_id = us.user_subject_id
       INNER JOIN grading_categories gc ON ge.cat_id = gc.cat_id
       WHERE us.user_id = ? AND ge.status = 'Done' AND ge.grade IS NOT NULL AND ${likeSql}`,
      [userId, ...likeParams]
    );
    doneGrades.push(...geGradeRows.map(r => Number(r.grade)));
  } catch {
    // grading tables not yet created
  }

  const pct      = total > 0 ? Math.round((completed / total) * 100) : 0;
  const avgGrade = doneGrades.length
    ? Math.round(doneGrades.reduce((a, b) => a + b, 0) / doneGrades.length)
    : 0;
  return { pct, avgGrade };
}

interface DynamicCategoryStat { name: string; pct: number; avgGrade: number; }

/* Custom categories whose name doesn't match any of the legacy Activity/Quiz/Exam
   keyword buckets (e.g. "Recitation", "Project", "Long Test") get their own
   dynamic row on the dashboard instead of being silently dropped. Categories
   with the same name (case-insensitive) across different subjects/periods are
   merged into a single row. Only categories with at least one logged entry
   show up, so an unused preset doesn't clutter the overview. */
const UNMATCHED_CLAUSE =
  `LOWER(gc.name) NOT LIKE '%activ%' AND LOWER(gc.name) NOT LIKE '%task%'
   AND LOWER(gc.name) NOT LIKE '%quiz%' AND LOWER(gc.name) NOT LIKE '%exam%'`;

async function getDynamicCategories(userId: number): Promise<DynamicCategoryStat[]> {
  try {
    const [totalRows] = await pool.execute<RowDataPacket[]>(
      `SELECT gc.name AS name,
              COUNT(*) AS total,
              SUM(CASE WHEN ge.status = 'Done' THEN 1 ELSE 0 END) AS completed
       FROM grade_entries ge
       INNER JOIN user_subjects us ON ge.user_subject_id = us.user_subject_id
       INNER JOIN grading_categories gc ON ge.cat_id = gc.cat_id
       WHERE us.user_id = ? AND ${UNMATCHED_CLAUSE}
       GROUP BY LOWER(TRIM(gc.name))`,
      [userId]
    );
    if (!totalRows.length) return [];

    const [gradeRows] = await pool.execute<RowDataPacket[]>(
      `SELECT gc.name AS name, ge.grade AS grade
       FROM grade_entries ge
       INNER JOIN user_subjects us ON ge.user_subject_id = us.user_subject_id
       INNER JOIN grading_categories gc ON ge.cat_id = gc.cat_id
       WHERE us.user_id = ? AND ge.status = 'Done' AND ge.grade IS NOT NULL AND ${UNMATCHED_CLAUSE}`,
      [userId]
    );
    const gradesByKey = new Map<string, number[]>();
    for (const r of gradeRows) {
      const key = String(r.name).trim().toLowerCase();
      if (!gradesByKey.has(key)) gradesByKey.set(key, []);
      gradesByKey.get(key)!.push(Number(r.grade));
    }

    return totalRows.map(r => {
      const key       = String(r.name).trim().toLowerCase();
      const total     = Number(r.total ?? 0);
      const completed = Number(r.completed ?? 0);
      const grades    = gradesByKey.get(key) ?? [];
      return {
        name:     String(r.name).trim(),
        pct:      total > 0 ? Math.round((completed / total) * 100) : 0,
        avgGrade: grades.length ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length) : 0,
      };
    });
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const filter = req.nextUrl.searchParams.get('filter');

  try {
    /* ── Filtered view (pill click) ── */
    if (filter) {
      let col1 = 0, col2 = 0, col3 = 0, col4 = 0;
      switch (filter) {
        case 'activities':
          col1 = await getTotal(userId, 'activities', 'Done');
          col2 = await getTotal(userId, 'activities', 'Pending');
          col3 = await getTotal(userId, 'activities');
          col4 = await getAvgGrade(userId, 'activities');
          break;
        case 'quizzes':
          col1 = await getTotal(userId, 'quizzes', 'Done');
          col2 = await getTotal(userId, 'quizzes', 'Pending');
          col3 = await getTotal(userId, 'quizzes');
          col4 = await getAvgGrade(userId, 'quizzes');
          break;
        case 'exams':
          col1 = await getTotal(userId, 'exams', 'Done');
          col2 = await getTotal(userId, 'exams', 'Pending');
          col3 = await getTotal(userId, 'exams');
          col4 = await getAvgGrade(userId, 'exams');
          break;
        case 'duedate':
          col1 = await getTotal(userId, 'activities', 'Pending');
          col2 = await getTotal(userId, 'quizzes',    'Pending');
          col3 = await getTotal(userId, 'exams',      'Pending');
          col4 = col1 + col2 + col3;
          break;
        case 'urgency':
          col1 = await getTotal(userId, 'activities', undefined, 'High');
          col2 = await getTotal(userId, 'quizzes',    undefined, 'High');
          col3 = await getTotal(userId, 'exams',      undefined, 'High');
          col4 = col1 + col2 + col3;
          break;
      }
      return Response.json({ col1, col2, col3, col4 });
    }

    /* ── Default overview + completion rows ── */
    const [subjectRows] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM user_subjects WHERE user_id = ?', [userId]
    );
    const subjectCount = Number(subjectRows[0].count);

    let daysRemaining: number | string = 'N/A';
    let trimesterLabel = '';
    try {
      const [trimRows] = await pool.execute<RowDataPacket[]>(
        'SELECT end_date, trimester_name, academic_year FROM trimesters WHERE user_id = ? ORDER BY trimester_id DESC LIMIT 1',
        [userId]
      );
      if (trimRows.length && trimRows[0].end_date) {
        const end   = new Date(String(trimRows[0].end_date).split('T')[0]);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);
        daysRemaining = Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86400000));
        trimesterLabel = `${trimRows[0].trimester_name} (${trimRows[0].academic_year})`;
      }
    } catch {
      // trimesters table not yet created
    }

    const [midtermGPA, finalGPA, actCompletion, quizCompletion, examCompletion, dynamicCategories] = await Promise.all([
      getOverallGPA(userId, 'midterm'),
      getOverallGPA(userId, 'final'),
      getCompletion(userId, 'activities'),
      getCompletion(userId, 'quizzes'),
      getCompletion(userId, 'exams'),
      getDynamicCategories(userId),
    ]);

    return Response.json({
      subjectCount,
      daysRemaining,
      midtermGPA,
      finalGPA,
      trimesterLabel,
      completion: {
        activity: actCompletion,
        quiz:     quizCompletion,
        exam:     examCompletion,
      },
      dynamicCategories,
    });
  } catch (err) {
    console.error('[studypulse/stats]', err);
    return Response.json({
      subjectCount: 0,
      daysRemaining: 'N/A',
      midtermGPA: 0,
      finalGPA: 0,
      trimesterLabel: '',
      completion: {
        activity: { pct: 0, avgGrade: 0 },
        quiz:     { pct: 0, avgGrade: 0 },
        exam:     { pct: 0, avgGrade: 0 },
      },
      dynamicCategories: [] as DynamicCategoryStat[],
    });
  }
}
