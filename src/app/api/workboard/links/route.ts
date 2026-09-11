import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { resolveOwner, type LinkOwner } from '@/lib/workboard/ownership';
import { createLink, isValidUrl, listLinks, LINK_TYPES, type LinkType } from '@/lib/workboard/links';

const OWNER_KINDS = ['owned', 'activities', 'quizzes', 'exams', 'grade_entries'];

/**
 * The list half of the collection, added in Task 23 for the Links cell's popover.
 *
 * The work payload carries only `link_count` per item — deliberately, so the table can render
 * a Links column without one query per row — so anything that needs the links themselves reads
 * them here, lazily, for one owner at a time.
 *
 * `resolveOwner` is the ownership gate and the *only* one: `workboard_item_links` carries its
 * own `user_id`, but filtering on that alone would answer a manipulated `owner_id` with an
 * empty list rather than a 404, which tells the caller the owner exists. Resolving the owner
 * first means a request for someone else's item is indistinguishable from a request for an
 * item that was never there.
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
  // A missing or non-numeric `owner_id` is a malformed request (400), not a lookup that
  // happens to miss (404) — so the raw string is tested before it is coerced. `Number()`
  // rather than `parseInt` for the numeric test, because `parseInt('12abc')` would silently
  // accept 12; but `Number` is no use on its own here either, since `Number(null)` and
  // `Number('')` are both 0, which is a perfectly good integer and would have sent an absent
  // parameter all the way to `resolveOwner` to come back as "Not found".
  const ownerId = Number(rawOwnerId);
  if (rawOwnerId === null || rawOwnerId.trim() === '' || !Number.isInteger(ownerId)) {
    return Response.json({ error: 'owner_id must be an integer' }, { status: 400 });
  }

  const owner = await resolveOwner(userId, { kind: ownerKind, id: ownerId } as LinkOwner);
  if (!owner) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json({ links: await listLinks(owner) });
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
  const { owner_kind, owner_id, label, url, link_type } = body;

  if (!OWNER_KINDS.includes(owner_kind)) {
    return Response.json({ error: 'Invalid owner_kind' }, { status: 400 });
  }
  if (typeof label !== 'string' || !label.trim() || label.length > 120) {
    return Response.json({ error: 'A label between 1 and 120 characters is required' }, { status: 400 });
  }
  if (!isValidUrl(url)) {
    return Response.json({ error: 'A valid http or https URL is required' }, { status: 400 });
  }
  if (link_type !== undefined && !LINK_TYPES.includes(link_type)) {
    return Response.json({ error: 'Invalid link_type' }, { status: 400 });
  }

  const owner = await resolveOwner(userId, { kind: owner_kind, id: parseInt(owner_id) } as LinkOwner);
  if (!owner) return Response.json({ error: 'Not found' }, { status: 404 });

  const id = await createLink(userId, owner, {
    label, url, link_type: (link_type ?? 'other') as LinkType,
  });
  return Response.json({ status: 'success', link_id: id });
}
