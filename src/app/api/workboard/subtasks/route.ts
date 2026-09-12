import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { resolveOwner, type LinkOwner } from '@/lib/workboard/ownership';
import { createSubtask, listSubtasks } from '@/lib/workboard/subtasks';

const OWNER_KINDS = ['owned', 'activities', 'quizzes', 'exams', 'grade_entries'];

/**
 * The list half of the collection, added in Task 32 for the detail drawer's SUBTASKS section —
 * the same shape, and the same reasoning, as `GET /api/workboard/links` (Task 23).
 *
 * The work payload carries only `subtask_total`/`subtask_done` per item — deliberately, so the
 * board can render progress without one query per row — so anything that needs the subtasks
 * themselves reads them here, lazily, for one owner at a time.
 *
 * `resolveOwner` is the ownership gate and the *only* one: `workboard_subtasks` carries its own
 * `user_id`, but filtering on that alone would answer a manipulated `owner_id` with an empty
 * list rather than a 404, which tells the caller the owner exists. Resolving the owner first
 * means a request for someone else's item is indistinguishable from a request for an item that
 * was never there.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();
  const userId = parseInt(session.user.id);

  const params = req.nextUrl.searchParams;
  const ownerKind = params.get('owner_kind');
  const rawOwnerId = params.get('owner_id');

  if (ownerKind === null || !OWNER_KINDS.includes(ownerKind)) {
    return Response.json({ error: 'Invalid owner_kind' }, { status: 400 });
  }
  // A missing or non-numeric `owner_id` is a malformed request (400), not a lookup that happens
  // to miss (404) — so the raw string is tested before it is coerced. `Number()` rather than
  // `parseInt` for the numeric test, because `parseInt('12abc')` would silently accept 12; but
  // `Number` is no use on its own either, since `Number(null)` and `Number('')` are both 0, a
  // perfectly good integer that would reach `resolveOwner` and come back as "Not found".
  // Identical to the links route's guard, deliberately: two collections with one owner contract.
  const ownerId = Number(rawOwnerId);
  if (rawOwnerId === null || rawOwnerId.trim() === '' || !Number.isInteger(ownerId)) {
    return Response.json({ error: 'owner_id must be an integer' }, { status: 400 });
  }

  const owner = await resolveOwner(userId, { kind: ownerKind, id: ownerId } as LinkOwner);
  if (!owner) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json({ subtasks: await listSubtasks(owner) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();
  const userId = parseInt(session.user.id);

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const { owner_kind, owner_id, title } = body;

  if (!OWNER_KINDS.includes(owner_kind)) {
    return Response.json({ error: 'Invalid owner_kind' }, { status: 400 });
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 255) {
    return Response.json({ error: 'A title between 1 and 255 characters is required' }, { status: 400 });
  }

  const owner = await resolveOwner(userId, { kind: owner_kind, id: parseInt(owner_id) } as LinkOwner);
  if (!owner) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json({ status: 'success', subtask_id: await createSubtask(userId, owner, title) });
}
