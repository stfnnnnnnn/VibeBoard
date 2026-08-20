import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureAccomplishedAt } from '@/lib/migrate';
import { insertActivityEntry, insertQuizEntry, insertExamEntry } from '@/lib/studypulseEntries';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureAccomplishedAt();

  const body = await req.json();
  const {
    type, entry_id, user_subject_id,
    name, specific_type, urgency, status, deadline,
    score, items, grade, accomplished_at,
  } = body;

  if (!user_subject_id || !name || !type) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const s  = score  != null && score  !== '' ? Number(score)  : null;
  const it = items  != null && items  !== '' ? Number(items)  : null;
  const g  = grade  != null && grade  !== '' ? Number(grade)  : null;
  const dl = deadline       || null;
  const ac = accomplished_at || null;

  let newId: number;

  switch (type) {
    case 'activities': {
      const { entryId } = await insertActivityEntry({
        entryId: entry_id, userSubjectId: user_subject_id, name, specificType: specific_type,
        urgency, status, deadline: dl, score: s, items: it, grade: g, accomplishedAt: ac,
      });
      newId = entryId;
      break;
    }
    case 'quizzes': {
      const { entryId } = await insertQuizEntry({
        entryId: entry_id, userSubjectId: user_subject_id, name, specificType: specific_type,
        urgency, status, deadline: dl, score: s, items: it, grade: g, accomplishedAt: ac,
      });
      newId = entryId;
      break;
    }
    case 'exams': {
      const { entryId } = await insertExamEntry({
        entryId: entry_id, userSubjectId: user_subject_id, name, specificType: specific_type,
        urgency, status, deadline: dl, score: s, items: it, grade: g, accomplishedAt: ac,
      });
      newId = entryId;
      break;
    }
    default:
      return Response.json({ error: 'Invalid type' }, { status: 400 });
  }

  return Response.json({ status: 'success', entry_id: newId, grade: g });
}
