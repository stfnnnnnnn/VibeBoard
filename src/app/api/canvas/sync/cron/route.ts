import { NextRequest } from 'next/server';
import { syncAllDueConnections } from '@/lib/canvas/sync';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!process.env.CANVAS_CRON_SECRET || secret !== process.env.CANVAS_CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await syncAllDueConnections();
  return Response.json({ status: 'success' });
}
