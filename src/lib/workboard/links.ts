import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { OwnerColumns } from '@/lib/workboard/ownership';

export const LINK_TYPES = [
  'canvas', 'drive', 'docs', 'github', 'figma', 'website', 'portal', 'form', 'other',
] as const;
export type LinkType = typeof LINK_TYPES[number];

export interface WorkLink {
  id:        number;
  label:     string;
  url:       string;
  link_type: LinkType;
  position:  number;
}

/** URLs are validated before storage and rendered by label, never as raw URLs (spec §10).
 *  Only http/https are accepted — a `javascript:` URL rendered as a link would be an
 *  injection vector, so the scheme allow-list is a security control, not a nicety. */
export function isValidUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function createLink(
  userId: number, owner: OwnerColumns,
  link: { label: string; url: string; link_type: LinkType },
): Promise<number> {
  const [maxRow] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM workboard_item_links
     WHERE \`${owner.column}\` = ?`,
    [owner.id],
  );
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO workboard_item_links (user_id, \`${owner.column}\`, label, url, link_type, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, owner.id, link.label.trim(), link.url, link.link_type, maxRow[0].next],
  );
  return res.insertId;
}
