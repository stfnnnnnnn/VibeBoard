import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface OrganizationSummary {
  id:     number;
  name:   string;
  status: 'active' | 'archived';
}

export async function listOrganizations(userId: number): Promise<OrganizationSummary[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, status FROM workboard_organizations
     WHERE user_id = ? ORDER BY status ASC, name ASC`,
    [userId],
  );
  return rows.map(r => ({ id: r.id, name: r.name, status: r.status }));
}

export async function createOrganization(userId: number, name: string): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO workboard_organizations (user_id, name) VALUES (?, ?)`,
    [userId, name.trim()],
  );
  return res.insertId;
}
