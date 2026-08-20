import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import StudyPulseLanding from '@/components/studypulse/StudyPulseLanding';

export default async function StudyPulsePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const userId    = parseInt(session.user.id);
  const firstName = session.user.name ?? 'Student';

  /* Fetch current trimester (null if table doesn't exist yet or columns missing) */
  let initialTrimester = null;
  try {
    const [trimRows] = await pool.execute<RowDataPacket[]>(
      `SELECT trimester_name, academic_year, start_date, end_date,
              ay_start_year, ay_end_year, term_system
       FROM trimesters WHERE user_id = ? ORDER BY trimester_id DESC LIMIT 1`,
      [userId]
    );
    if (trimRows.length) {
      const t = trimRows[0];
      initialTrimester = {
        ay_start_year: t.ay_start_year != null ? Number(t.ay_start_year) : null,
        ay_end_year:   t.ay_end_year   != null ? Number(t.ay_end_year)   : null,
        term_system:   (t.term_system  as 'Semestral' | 'Trimestral' | 'Quarterly' | null) ?? null,
        current_term:  (t.trimester_name as string | null) ?? null,
        academic_year: (t.academic_year  as string | null) ?? null,
        start_date:    t.start_date ? String(t.start_date).split('T')[0] : '',
        end_date:      t.end_date   ? String(t.end_date).split('T')[0]   : '',
      };
    }
  } catch {
    // trimesters table missing new columns — user will set it up via the modal
  }

  return (
    <StudyPulseLanding
      initialTrimester={initialTrimester}
      firstName={firstName}
    />
  );
}
