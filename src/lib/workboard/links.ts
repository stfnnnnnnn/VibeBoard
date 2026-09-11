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

/**
 * Every link attached to one already-resolved owner, in `position` order.
 *
 * Added in Task 23, not Task 5: the POST route was built before anything needed reads, and
 * Task 5's report flagged that whichever task first needed them would add the query here
 * rather than inlining SQL in a route. `GET /api/workboard/links` is that caller.
 *
 * **`resolveOwner` is the ownership gate, not this function.** The `WHERE` scopes by the owner
 * column alone — exactly as `createLink`'s position query does, and for the same reason: the
 * caller has already proved the owner belongs to the user, and an owner can only ever belong
 * to one (an owned item carries its own `user_id`; an academic entry reaches its user through
 * `user_subjects`). Passing an `OwnerColumns` rather than raw request values is what makes that
 * precondition structural — the value can only come from `resolveOwner`.
 *
 * The `owner.column` interpolation is safe on the same terms as `createLink`'s: it comes only
 * from `OWNER_SPECS`, never from request input.
 *
 * `id` is the tie-break, not decoration. `createLink` derives the next position with
 * `MAX(position) + 1`, which is not atomic, so two adds racing on the same owner can land on
 * the same number; without the second key MySQL would be free to return those two in either
 * order on successive reads, and the list would reshuffle for no reason the user can see.
 */
export async function listLinks(owner: OwnerColumns): Promise<WorkLink[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, label, url, link_type, position
       FROM workboard_item_links
      WHERE \`${owner.column}\` = ?
      ORDER BY position ASC, id ASC`,
    [owner.id],
  );
  return rows.map(r => ({
    id:        Number(r.id),
    label:     String(r.label),
    url:       String(r.url),
    // `link_type` is a VARCHAR the POST/PATCH routes whitelist against `LINK_TYPES` before
    // writing, so this is a compile-time assertion over DB text — the same contract
    // `work_stage` has in `workItems.ts`. A hand-edited row falls back to `'other'` at the
    // rendering end rather than being dropped here.
    link_type: r.link_type as LinkType,
    position:  Number(r.position),
  }));
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
