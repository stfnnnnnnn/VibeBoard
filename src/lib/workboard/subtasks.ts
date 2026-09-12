import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { OwnerColumns } from '@/lib/workboard/ownership';

export interface Subtask {
  id:       number;
  title:    string;
  is_done:  boolean;
  position: number;
}

/**
 * Every subtask attached to one already-resolved owner, in `position` order.
 *
 * Added in Task 32, not Task 6, for exactly the reason `listLinks` was added in Task 23 rather
 * than Task 5: the POST route was built before anything needed reads, and the first caller that
 * needs them adds the query here rather than inlining SQL in a route. The detail drawer's
 * SUBTASKS section is that caller, through `GET /api/workboard/subtasks`.
 *
 * **`resolveOwner` is the ownership gate, not this function.** The `WHERE` scopes by the owner
 * column alone — exactly as `createSubtask`'s position query does, and for the same reason: the
 * caller has already proved the owner belongs to the user, and an owner can only ever belong to
 * one (an owned item carries its own `user_id`; an academic entry reaches its user through
 * `user_subjects`). Passing an `OwnerColumns` rather than raw request values is what makes that
 * precondition structural — the value can only come from `resolveOwner`.
 *
 * The `owner.column` interpolation is safe on the same terms as `createSubtask`'s: it comes only
 * from `OWNER_SPECS`, never from request input.
 *
 * `id` is the tie-break, not decoration. `createSubtask` derives the next position with
 * `MAX(position) + 1`, which is not atomic, so two adds racing on the same owner can land on the
 * same number; without the second key MySQL would be free to return those two in either order on
 * successive reads, and the list would reshuffle for no reason the user can see.
 */
export async function listSubtasks(owner: OwnerColumns): Promise<Subtask[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, title, is_done, position
       FROM workboard_subtasks
      WHERE \`${owner.column}\` = ?
      ORDER BY position ASC, id ASC`,
    [owner.id],
  );
  return rows.map(r => ({
    id:       Number(r.id),
    title:    String(r.title),
    // TINYINT(1) off the wire, so `Boolean` rather than a cast: the PATCH route writes 1/0 and
    // mysql2 hands those back as numbers, which JSON would otherwise ship as `1`/`0` to a
    // client whose `is_done` is typed `boolean`.
    is_done:  Boolean(r.is_done),
    position: Number(r.position),
  }));
}

export async function createSubtask(
  userId: number, owner: OwnerColumns, title: string,
): Promise<number> {
  const [maxRow] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM workboard_subtasks
     WHERE \`${owner.column}\` = ?`,
    [owner.id],
  );
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO workboard_subtasks (user_id, \`${owner.column}\`, title, position)
     VALUES (?, ?, ?, ?)`,
    [userId, owner.id, title.trim(), maxRow[0].next],
  );
  return res.insertId;
}
