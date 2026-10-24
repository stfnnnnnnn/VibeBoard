import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureCanvasSchema } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';
import CanvasClientShell from './CanvasClientShell';
import type { HubTab, PendingCounts } from '@/components/studypulse/canvas/types';
import '../studypulse.css';

const TABS: HubTab[] = ['overview', 'bank', 'announcements'];

/** Pending bank items / to-review announcements per mapped subject ('none' = an unmapped course). Ownership is the
    canvas_connections.user_id join, the same chain GET /api/canvas/bank and /announcements use. */
async function countPending(table: 'canvas_activity_bank' | 'canvas_announcement_bank', userId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT cc.user_subject_id AS sid, COUNT(*) AS n
       FROM ${table} bank
       JOIN canvas_courses cc ON cc.id = bank.course_id
       JOIN canvas_connections conn ON conn.id = bank.connection_id
      WHERE conn.user_id = ? AND bank.bank_status = 'pending'
      GROUP BY cc.user_subject_id`,
    [userId],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.sid === null ? 'none' : String(r.sid)] = Number(r.n);
  return out;
}

export default async function CanvasPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  await ensureCanvasSchema();
  const userId = parseInt(session.user.id);
  const params = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

  // last_sync_at is written with MySQL NOW(), so its age is measured by MySQL too (no client/server timezone guess).
  const [connRows] = await pool.execute<RowDataPacket[]>(
    `SELECT canvas_user_name, status, last_sync_at, last_sync_status, token_expires_at,
            TIMESTAMPDIFF(SECOND, last_sync_at, NOW()) AS last_sync_age_s
       FROM canvas_connections WHERE user_id = ? AND status IN ('active', 'invalid')`,
    [userId],
  );

  const [subjectRows] = await pool.execute<RowDataPacket[]>(
    `SELECT us.user_subject_id, s.subject_name, s.course_code FROM user_subjects us
     JOIN subjects s ON s.subject_id = us.subject_id WHERE us.user_id = ?`,
    [userId],
  );
  const subjects = subjectRows.map(r => ({
    user_subject_id: r.user_subject_id as number,
    subject_name: r.subject_name as string,
    course_code: (r.course_code as string | null) ?? null,
  }));

  const conn = connRows[0];
  let courses: RowDataPacket[] = [];
  let counts: PendingCounts = { bank: {}, announcements: {} };
  if (conn) {
    // The same query as GET /api/canvas/courses, so the Overview paints with its courses instead of an empty flash.
    [courses] = await pool.execute<RowDataPacket[]>(
      `SELECT cc.* FROM canvas_courses cc
       JOIN canvas_connections conn ON conn.id = cc.connection_id
       WHERE conn.user_id = ?
       ORDER BY cc.mapping_status = 'pending' DESC, cc.name ASC`,
      [userId],
    );
    counts = {
      bank: await countPending('canvas_activity_bank', userId),
      announcements: await countPending('canvas_announcement_bank', userId),
    };
  }

  // ?subject= only counts when it names one of the user's own subjects.
  const subjectParam = one(params.subject);
  const subject = subjectParam && /^\d+$/.test(subjectParam) && subjects.some(s => s.user_subject_id === Number(subjectParam))
    ? Number(subjectParam) : null;

  // Default tab: ?tab= when valid, else the Activity Bank when anything in it is pending (for the scoped subject when
  // ?subject= is set), else the Overview.
  const tabParam = one(params.tab) as HubTab | null;
  const bankPending = subject === null
    ? Object.values(counts.bank).reduce((a, b) => a + b, 0)
    : counts.bank[String(subject)] ?? 0;
  const tab: HubTab = tabParam && TABS.includes(tabParam) ? tabParam : bankPending > 0 ? 'bank' : 'overview';

  // Days until the token expires, computed as the old panel did (token_expires_at is stored as UTC). Done here so the
  // server and client renders agree.
  const tokenExpires = conn?.token_expires_at as string | null | undefined;
  const tokenDaysLeft = tokenExpires
    ? Math.ceil((new Date(tokenExpires.replace(' ', 'T') + 'Z').getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  return (
    <CanvasClientShell
      connection={conn ? {
        connected: true,
        canvas_user_name: conn.canvas_user_name as string,
        status: conn.status as 'active' | 'invalid',
        last_sync_at: conn.last_sync_at as string | null,
        last_sync_status: conn.last_sync_status as 'success' | 'partial' | 'failed' | null,
        last_sync_age_s: conn.last_sync_age_s === null ? null : Number(conn.last_sync_age_s),
        token_expires_at: tokenExpires ?? null,
        token_days_left: tokenDaysLeft,
      } : { connected: false }}
      subjects={subjects}
      initialCourses={courses.map(c => ({
        id: c.id as number,
        canvas_course_id: Number(c.canvas_course_id),
        name: c.name as string,
        course_code: (c.course_code as string | null) ?? null,
        term: (c.term as string | null) ?? null,
        mapping_status: c.mapping_status as 'pending' | 'linked' | 'created' | 'ignored',
        user_subject_id: (c.user_subject_id as number | null) ?? null,
      }))}
      counts={counts}
      initialTab={tab}
      initialSubject={subject}
    />
  );
}
