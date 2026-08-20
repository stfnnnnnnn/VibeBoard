import crypto from 'crypto';
import type { RowDataPacket } from 'mysql2';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.CANVAS_TOKEN_ENC_KEY;
  if (!hex) throw new Error('CANVAS_TOKEN_ENC_KEY is not set');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('CANVAS_TOKEN_ENC_KEY must be 32 bytes (64 hex chars)');
  return key;
}

export interface EncryptedToken {
  enc: Buffer;
  iv:  Buffer;
  tag: Buffer;
}

export function encryptToken(plain: string): EncryptedToken {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc    = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return { enc, iv, tag };
}

export function decryptToken(enc: Buffer, iv: Buffer, tag: Buffer): string {
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export interface CanvasConnectionRow extends RowDataPacket {
  id:                number;
  user_id:           number;
  base_url:          string;
  canvas_user_id:    number;
  canvas_user_name:  string | null;
  access_token_enc:  Buffer | null;
  token_iv:          Buffer | null;
  token_tag:         Buffer | null;
  status:            'active' | 'invalid' | 'disconnected';
  last_sync_at:      string | null;
  last_sync_status:  'success' | 'partial' | 'failed' | null;
  last_error:        string | null;
}

export function getAccessToken(connection: CanvasConnectionRow): string {
  if (!connection.access_token_enc || !connection.token_iv || !connection.token_tag) {
    throw new Error(`Canvas connection ${connection.id} has no stored token`);
  }
  return decryptToken(connection.access_token_enc, connection.token_iv, connection.token_tag);
}
