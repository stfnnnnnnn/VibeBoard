import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { OwnerColumns } from '@/lib/workboard/ownership';

export interface Subtask {
  id:       number;
  title:    string;
  is_done:  boolean;
  position: number;
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
