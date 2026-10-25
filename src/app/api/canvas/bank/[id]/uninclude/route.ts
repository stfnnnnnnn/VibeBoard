import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { gradeBreakdown } from '@/lib/canvas/normalize';

/** The linked entry's table and primary key, by the non-null column on canvas_entry_links. */
const ENTRY_TABLES = {
  activity_id:    { table: 'activities',    pk: 'activity_id' },
  quiz_id:        { table: 'quizzes',       pk: 'quiz_id' },
  exam_id:        { table: 'exams',         pk: 'exam_id' },
  grade_entry_id: { table: 'grade_entries', pk: 'entry_id' },
} as const;
type LinkColumn = keyof typeof ENTRY_TABLES;

const UNDO_WINDOW_MINUTES = 15;
const CHANGED = { error: 'This entry has changed since it was added' };

/** DECIMAL(5,2) entry values against the unrounded Canvas breakdown: equal to the cent. */
function sameValue(stored: unknown, expected: number | null): boolean {
  if (stored === null || stored === undefined) return expected === null;
  if (expected === null) return false;
  return Math.abs(Number(stored) - Math.round(expected * 100) / 100) < 0.005;
}

/**
 * Undo an Include: deletes the entry it created (the link and any Workboard overlay cascade)
 * and returns the bank item to pending. Only allowed within 15 minutes of the Include and while
 * the entry's score/items are still exactly what the Include wrote.
 */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await props.params;
  const bankId = parseInt(id);
  const userId = parseInt(session.user.id);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Ownership first: the bank item must belong to one of this user's Canvas connections.
    const [owned] = await conn.execute<RowDataPacket[]>(
      `SELECT bank.id, bank.bank_status, bank.points_possible, bank.submission_score
       FROM canvas_activity_bank bank
       JOIN canvas_connections conn ON conn.id = bank.connection_id
       WHERE bank.id = ? AND conn.user_id = ?
       FOR UPDATE`,
      [bankId, userId],
    );
    if (owned.length === 0) {
      await conn.rollback();
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    const item = owned[0];

    const [links] = await conn.execute<RowDataPacket[]>(
      `SELECT activity_id, quiz_id, exam_id, grade_entry_id,
              created_at >= NOW() - INTERVAL ${UNDO_WINDOW_MINUTES} MINUTE AS fresh
       FROM canvas_entry_links WHERE bank_item_id = ?
       FOR UPDATE`,
      [bankId],
    );
    if (links.length === 0) {
      await conn.rollback();
      return Response.json({ error: 'This item has no linked entry' }, { status: 404 });
    }
    const link = links[0];
    const column = (Object.keys(ENTRY_TABLES) as LinkColumn[]).find(c => link[c] !== null);
    if (!column) {
      await conn.rollback();
      return Response.json({ error: 'This item has no linked entry' }, { status: 404 });
    }
    const { table, pk } = ENTRY_TABLES[column];
    const entryId = link[column] as number;

    // The entry's subject must belong to the user too.
    const [entries] = await conn.execute<RowDataPacket[]>(
      `SELECT e.score, e.items FROM ${table} e
       JOIN user_subjects us ON us.user_subject_id = e.user_subject_id
       WHERE e.${pk} = ? AND us.user_id = ?
       FOR UPDATE`,
      [entryId, userId],
    );
    if (entries.length === 0) {
      await conn.rollback();
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const expected = gradeBreakdown(item.submission_score, item.points_possible);
    const entry = entries[0];
    if (
      item.bank_status !== 'included' || !Number(link.fresh)
      || !sameValue(entry.score, expected.score) || !sameValue(entry.items, expected.items)
    ) {
      await conn.rollback();
      return Response.json(CHANGED, { status: 409 });
    }

    // Deleting the entry cascades to canvas_entry_links and workboard_entry_meta.
    await conn.execute(`DELETE FROM ${table} WHERE ${pk} = ?`, [entryId]);
    await conn.execute(`UPDATE canvas_activity_bank SET bank_status = 'pending' WHERE id = ?`, [bankId]);

    await conn.commit();
    return Response.json({ status: 'success' });
  } catch (err) {
    await conn.rollback();
    console.error('Canvas uninclude failed:', err);
    return Response.json({ error: 'Couldn’t undo that. Try again.' }, { status: 500 });
  } finally {
    conn.release();
  }
}
