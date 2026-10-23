/* user_login access for auth (spec §3.4). Server-only. Every call ensures the auth v2 schema first. */
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '@/lib/db';
import { ensureAuthV2Schema } from '@/lib/migrate';

export interface AuthUser {
  user_id: number;
  first_name: string;
  surname: string;
  email: string;
  password: string | null;
  google_sub: string | null;
  email_verified_at: string | null;
  session_version: number;
  failed_attempts: number;
  /** Seconds since last_attempt, computed by the DB (time-zone independent); null when never failed. */
  since_last_attempt: number | null;
  year_level: string | null;
}
interface Row extends RowDataPacket, AuthUser {}

export interface NewUser {
  first_name: string;
  surname: string;
  email: string;
  password_hash: string | null;
  google_sub: string | null;
  email_verified: boolean;
  year_level: string | null;
}

const COLS = `user_id, first_name, surname, email, password, google_sub, email_verified_at, session_version,
  failed_attempts, TIMESTAMPDIFF(SECOND, last_attempt, NOW()) AS since_last_attempt, year_level`;

async function one(where: string, params: (string | number)[]): Promise<AuthUser | null> {
  await ensureAuthV2Schema();
  const [rows] = await pool.execute<Row[]>(`SELECT ${COLS} FROM user_login WHERE ${where} LIMIT 1`, params);
  return rows[0] ?? null;
}

export const findByEmail = (email: string) => one('email = ?', [email.trim().toLowerCase()]);
export const findByGoogleSub = (sub: string) => one('google_sub = ?', [sub]);
export const findById = (id: number) => one('user_id = ?', [id]);

export async function createUser(u: NewUser): Promise<number> {
  await ensureAuthV2Schema();
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO user_login (first_name, surname, email, password, google_sub, email_verified_at, year_level)
     VALUES (?, ?, ?, ?, ?, ${u.email_verified ? 'NOW()' : 'NULL'}, ?)`,
    [u.first_name, u.surname, u.email.trim().toLowerCase(), u.password_hash, u.google_sub, u.year_level],
  );
  return r.insertId;
}

/** Link a Google identity to an existing account. A password set on an account whose owner never proved
 *  the email is untrusted: clear it and sign out other sessions (spec D11, fixes pre-hijack). */
export async function linkGoogle(u: AuthUser, sub: string): Promise<void> {
  const untrusted = u.password !== null && u.email_verified_at === null;
  await pool.execute(
    `UPDATE user_login SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, NOW())
       ${untrusted ? ', password = NULL, session_version = session_version + 1' : ''}
     WHERE user_id = ?`,
    [sub, u.user_id],
  );
}

export async function recordFailedLogin(id: number): Promise<void> {
  await pool.execute(`UPDATE user_login SET failed_attempts = failed_attempts + 1, last_attempt = NOW() WHERE user_id = ?`, [id]);
}

export async function clearFailedLogins(id: number): Promise<void> {
  await pool.execute(`UPDATE user_login SET failed_attempts = 0, last_attempt = NULL WHERE user_id = ?`, [id]);
}

export async function getSessionVersion(id: number): Promise<number | null> {
  await ensureAuthV2Schema();
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT session_version FROM user_login WHERE user_id = ?`, [id]);
  return rows[0] ? Number(rows[0].session_version) : null;
}
