import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureCanvasSchema } from '@/lib/migrate';
import { runConnectFlow, InvalidBaseUrlError } from '@/lib/canvas/connectFlow';
import { CanvasAuthError, CanvasApiError } from '@/lib/canvas/errors';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCanvasSchema();

  const { base_url, access_token } = await req.json();
  if (!base_url || !access_token) {
    return Response.json({ error: 'base_url and access_token are required' }, { status: 400 });
  }

  const userId = parseInt(session.user.id);
  try {
    const result = await runConnectFlow(userId, base_url, access_token);
    return Response.json({ status: 'success', canvas_user_name: result.canvasUserName });
  } catch (err) {
    if (err instanceof InvalidBaseUrlError || err instanceof CanvasAuthError || err instanceof CanvasApiError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
