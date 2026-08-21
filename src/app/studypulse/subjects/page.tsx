import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureSubjectSection } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';
import SubjectsGrid from '@/components/studypulse/SubjectsGrid';

export default async function SubjectsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const userId = parseInt(session.user.id);
  await ensureSubjectSection();

  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT us.user_subject_id, s.subject_name, s.course_code, s.section,
           s.units, s.year_level, s.trimester
    FROM user_subjects us
    JOIN subjects s ON us.subject_id = s.subject_id
    WHERE us.user_id = ?
    ORDER BY us.user_subject_id DESC
  `, [userId]);

  const subjects = await Promise.all(rows.map(async (sub) => {
    const [prog] = await pool.execute<RowDataPacket[]>(`
      SELECT
        SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS completed,
        COUNT(*) AS total
      FROM (
        SELECT status FROM activities WHERE user_subject_id = ?
        UNION ALL
        SELECT status FROM quizzes WHERE user_subject_id = ?
        UNION ALL
        SELECT status FROM exams WHERE user_subject_id = ?
        UNION ALL
        SELECT status FROM grade_entries WHERE user_subject_id = ?
      ) t
    `, [sub.user_subject_id, sub.user_subject_id, sub.user_subject_id, sub.user_subject_id]);

    const completed = Number(prog[0].completed ?? 0);
    const total     = Number(prog[0].total ?? 0);

    return {
      user_subject_id:  sub.user_subject_id as number,
      subject_name:     sub.subject_name as string,
      course_code:      sub.course_code  as string,
      section:          sub.section as string | null,
      units:            sub.units        as number,
      year_level:       sub.year_level   as string,
      trimester:        sub.trimester    as string,
      completed_tasks:  completed,
      total_tasks:      total,
      progress_percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }));

  return <SubjectsGrid initialSubjects={subjects} />;
}
