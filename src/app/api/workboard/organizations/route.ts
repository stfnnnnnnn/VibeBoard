import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { listOrganizations, createOrganization } from '@/lib/workboard/organizations';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();
  return Response.json({ organizations: await listOrganizations(parseInt(session.user.id)) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const { name } = body;
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'An organization name is required' }, { status: 400 });
  }

  try {
    return Response.json({ status: 'success', organization_id: await createOrganization(parseInt(session.user.id), name) });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return Response.json({ error: 'You already have an organization with that name' }, { status: 400 });
    }
    throw err;
  }
}
