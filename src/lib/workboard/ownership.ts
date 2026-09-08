import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export interface ReferenceCheck {
  projectId?:      unknown;
  userSubjectId?:  unknown;
  organizationId?: unknown;
}

/** Returns null when every supplied reference is absent or genuinely the user's;
 *  returns a message when a supplied id is not theirs. Never trust an id from a
 *  request body — this is the guard v1's final review found missing. */
export async function checkReferences(userId: number, refs: ReferenceCheck): Promise<string | null> {
  const checks: [unknown, string, string, string][] = [
    [refs.projectId,      'workboard_projects',      'id',              'That project was not found'],
    [refs.userSubjectId,  'user_subjects',           'user_subject_id', 'That subject was not found'],
    [refs.organizationId, 'workboard_organizations', 'id',              'That organization was not found'],
  ];

  for (const [value, table, idCol, message] of checks) {
    if (value === null || value === undefined) continue;
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM \`${table}\` WHERE \`${idCol}\` = ? AND user_id = ?`,
      [value as string | number, userId],
    );
    if (!rows.length) return message;
  }
  return null;
}

/** Links and subtasks attach to exactly one owner: a Workboard item or one of the four
 *  Study Pulse entry tables. */
export type LinkOwner =
  | { kind: 'owned';          id: number }
  | { kind: 'activities';     id: number }
  | { kind: 'quizzes';        id: number }
  | { kind: 'exams';          id: number }
  | { kind: 'grade_entries';  id: number };

export interface OwnerColumns {
  column: 'work_item_id' | 'activity_id' | 'quiz_id' | 'exam_id' | 'grade_entry_id';
  id:     number;
}

const OWNER_SPECS: Record<LinkOwner['kind'], { table: string; pk: string; column: OwnerColumns['column'] }> = {
  owned:         { table: 'workboard_work_items', pk: 'id',          column: 'work_item_id' },
  activities:    { table: 'activities',           pk: 'activity_id', column: 'activity_id' },
  quizzes:       { table: 'quizzes',              pk: 'quiz_id',     column: 'quiz_id' },
  exams:         { table: 'exams',                pk: 'exam_id',     column: 'exam_id' },
  grade_entries: { table: 'grade_entries',        pk: 'entry_id',    column: 'grade_entry_id' },
};

/**
 * Confirms the owner belongs to this user and returns which column to write.
 * Owned items carry their own `user_id`; Study Pulse entries have none, so ownership
 * is established by joining `user_subjects` — the same rule every academic path uses.
 * Returns null when the owner is not the user's, which callers turn into a 404.
 */
export async function resolveOwner(userId: number, owner: LinkOwner): Promise<OwnerColumns | null> {
  const spec = OWNER_SPECS[owner.kind];
  if (!spec) return null;

  const sql = owner.kind === 'owned'
    ? `SELECT 1 FROM \`${spec.table}\` WHERE \`${spec.pk}\` = ? AND user_id = ?`
    : `SELECT 1 FROM \`${spec.table}\` t
       JOIN user_subjects us ON us.user_subject_id = t.user_subject_id
       WHERE t.\`${spec.pk}\` = ? AND us.user_id = ?`;

  const [rows] = await pool.execute<RowDataPacket[]>(sql, [owner.id, userId]);
  if (!rows.length) return null;
  return { column: spec.column, id: owner.id };
}
