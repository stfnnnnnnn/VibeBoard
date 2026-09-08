import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { resolveOwner, type LinkOwner } from '@/lib/workboard/ownership';
import { createLink, isValidUrl, LINK_TYPES, type LinkType } from '@/lib/workboard/links';

const OWNER_KINDS = ['owned', 'activities', 'quizzes', 'exams', 'grade_entries'];

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
