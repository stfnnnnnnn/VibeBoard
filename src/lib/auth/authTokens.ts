/* auth_tokens: single-use, hashed, expiring links for password reset and email verification (spec §4.6–4.7). */
import type { RowDataPacket } from 'mysql2';
import pool from '@/lib/db';
import { ensureAuthV2Schema } from '@/lib/migrate';
import { newToken, hashToken, RESEND_COOLDOWN_SEC } from '@/lib/auth/tokens';

export type TokenPurpose = 'reset' | 'verify';

/** Returns the raw token to email, or null when one was issued for this user+purpose in the cooldown window. */
export async function issueToken(userId: number, purpose: TokenPurpose, ttlMinutes: number): Promise<string | null> {
  await ensureAuthV2Schema();
  const [recent] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM auth_tokens WHERE user_id = ? AND purpose = ? AND created_at > NOW() - INTERVAL ? SECOND LIMIT 1`,
    [userId, purpose, RESEND_COOLDOWN_SEC],
  );
  if (recent.length) return null;
  const token = newToken();
  await pool.execute(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL ? MINUTE)`,
    [userId, purpose, hashToken(token), ttlMinutes],
  );
  return token;
}

/** Read-only check used to render the reset page. Does not consume the token. */
export async function peekToken(token: string, purpose: TokenPurpose): Promise<{ user_id: number; email: string; first_name: string } | null> {
  if (!token) return null;
  await ensureAuthV2Schema();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT t.user_id, u.email, u.first_name FROM auth_tokens t JOIN user_login u ON u.user_id = t.user_id
      WHERE t.token_hash = ? AND t.purpose = ? AND t.used_at IS NULL AND t.expires_at > NOW()`,
    [hashToken(token), purpose],
  );
  return rows[0] ? { user_id: Number(rows[0].user_id), email: String(rows[0].email), first_name: String(rows[0].first_name) } : null;
}

/** Atomically: consume the token, expire the user's other reset tokens, set the password, clear the lock,
 *  bump session_version (signs out other devices), mark the email verified. Returns user_id or null. */
export async function resetPassword(token: string, passwordHash: string): Promise<number | null> {
  if (!token) return null;
  await ensureAuthV2Schema();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT token_id, user_id FROM auth_tokens
        WHERE token_hash = ? AND purpose = 'reset' AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`,
      [hashToken(token)],
    );
    if (!rows.length) { await conn.rollback(); return null; }
    const userId = Number(rows[0].user_id);
    await conn.execute(`UPDATE auth_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL`, [userId]);
    await conn.execute(
      `UPDATE user_login SET password = ?, failed_attempts = 0, last_attempt = NULL,
              session_version = session_version + 1, email_verified_at = COALESCE(email_verified_at, NOW())
        WHERE user_id = ?`,
      [passwordHash, userId],
    );
    await conn.commit();
    return userId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function consumeVerifyToken(token: string): Promise<number | null> {
  if (!token) return null;
  await ensureAuthV2Schema();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT user_id FROM auth_tokens
        WHERE token_hash = ? AND purpose = 'verify' AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`,
      [hashToken(token)],
    );
    if (!rows.length) { await conn.rollback(); return null; }
    const userId = Number(rows[0].user_id);
    await conn.execute(`UPDATE auth_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = 'verify' AND used_at IS NULL`, [userId]);
    await conn.execute(`UPDATE user_login SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE user_id = ?`, [userId]);
    await conn.commit();
    return userId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
