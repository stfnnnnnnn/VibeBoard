import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { ensureWorkboardSchema } from '@/lib/migrate';
import { insertWorkboardItem } from '@/lib/workboard/items';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardSchema();
  const userId = parseInt(session.user.id);

  const body = await req.json();
  const { item_type, title, user_subject_id, location, starts_at, ends_at, remind_at, note } = body;

  if (item_type !== 'event' && item_type !== 'reminder') {
    return Response.json({ error: 'item_type must be "event" or "reminder"' }, { status: 400 });
  }
  if (!title || typeof title !== 'string') {
    return Response.json({ error: 'title is required' }, { status: 400 });
  }
  if (item_type === 'event' && (!starts_at || !ends_at)) {
    return Response.json({ error: 'Events require starts_at and ends_at' }, { status: 400 });
  }
  if (user_subject_id != null) {
    const [owns] = await pool.execute<RowDataPacket[]>(
      'SELECT 1 FROM user_subjects WHERE user_subject_id = ? AND user_id = ?', [user_subject_id, userId],
    );
    if (!owns.length) return Response.json({ error: 'That subject was not found' }, { status: 400 });
  }

  const { itemId } = await insertWorkboardItem({
    userId, userSubjectId: user_subject_id ?? null, itemType: item_type, title,
    location: location || null, startsAt: starts_at || null, endsAt: ends_at || null,
    remindAt: remind_at || null, note: note || null,
    sourceType: 'manual', sourceAnnouncementId: null,
  });

  return Response.json({ status: 'success', item_id: itemId });
}
