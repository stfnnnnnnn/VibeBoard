import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { resolveOwner, type LinkOwner } from '@/lib/workboard/ownership';
import { createSubtask } from '@/lib/workboard/subtasks';

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
