import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { ensureWorkboardSchema } from '@/lib/migrate';
import { getWorkboardWeek, mondayOf, todayInManilaAsUtcDate } from '@/lib/workboard/aggregate';
import ScheduleMaker from '@/components/studypulse/ScheduleMaker';

export default async function SchedulePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const userId = parseInt(session.user.id);
  await ensureWorkboardSchema();

  const [blockRows] = await pool.execute<RowDataPacket[]>(
    `SELECT sb.block_id, sb.user_subject_id, sb.course_code, sb.section, sb.instructor, sb.meeting_link,
            sb.day_of_week, sb.start_time, sb.end_time, sb.venue, sb.is_online, sb.modality,
            s.subject_name, s.trimester, s.year_level, s.units
     FROM schedule_blocks sb
     LEFT JOIN user_subjects us ON sb.user_subject_id = us.user_subject_id
     LEFT JOIN subjects s ON us.subject_id = s.subject_id
     WHERE sb.user_id = ?
     ORDER BY sb.day_of_week ASC, sb.start_time ASC`,
    [userId]
  );

  const [subjectRows] = await pool.execute<RowDataPacket[]>(
    `SELECT us.user_subject_id, s.subject_name, s.course_code, s.units, s.trimester, s.year_level
     FROM user_subjects us
     JOIN subjects s ON us.subject_id = s.subject_id
     WHERE us.user_id = ?
     ORDER BY s.course_code ASC`,
    [userId]
  );

  const blocks = blockRows.map(r => ({
    block_id:        r.block_id as number,
    user_subject_id: r.user_subject_id as number | null,
    course_code:     r.course_code as string,
    section:         r.section as string | null,
    instructor:      r.instructor as string | null,
    meeting_link:    r.meeting_link as string | null,
    subject_name:    r.subject_name as string | null,
    trimester:       r.trimester as string | null,
    year_level:      r.year_level as string | null,
    units:           r.units as number | null,
    day_of_week:     r.day_of_week as number,
    start_time:      String(r.start_time).slice(0, 5),
    end_time:        String(r.end_time).slice(0, 5),
    venue:           r.venue as string | null,
    modality:        r.modality as 'face_to_face' | 'online_sync' | 'online_async',
  }));

  const subjects = subjectRows.map(r => ({
    user_subject_id: r.user_subject_id as number,
    subject_name:    r.subject_name as string,
    course_code:     r.course_code as string,
    units:           r.units as number,
    trimester:       r.trimester as string | null,
    year_level:      r.year_level as string | null,
  }));

  // ScheduleMaker's grid is a recurring weekly TEMPLATE (no date of its own) — but clicking a
  // pill to flag "this occurrence" as cancelled/online/rescheduled needs a real calendar date.
  // The current week's occurrences (same shape Workboard's Timeline already uses) give each
  // block a concrete "this week" date to attach an override to, and any override already saved
  // against that date so the grid can render it dimmed on load, not just after a click.
  const weekStart = mondayOf(todayInManilaAsUtcDate());
  const { class_occurrences: classOccurrences } = await getWorkboardWeek(userId, weekStart);

  return <ScheduleMaker initialBlocks={blocks} subjects={subjects} classOccurrences={classOccurrences} weekStart={weekStart} />;
}
