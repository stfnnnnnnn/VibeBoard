import { NextRequest } from 'next/server';
import { ensureCanvasSchema } from '@/lib/migrate';
import { syncAllDueConnections } from '@/lib/canvas/sync';

/**
 * Keep this route's execution budget explicit: `syncAllDueConnections()` walks a batch of
 * connections serially, each making several paginated Canvas calls. Declared as Next.js
 * route segment config (rather than a `functions` entry in vercel.json) because that's the
 * documented App Router mechanism and can't break the build with a non-matching path glob.
 */
export const maxDuration = 60;

/**
 * Vercel Cron invokes the configured path with **GET**, so GET is the handler that actually
 * matters in production; POST is kept for manual `curl` triggering.
 *
 * The shared secret lives in `CRON_SECRET` specifically because Vercel automatically sends
 * `Authorization: Bearer $CRON_SECRET` on cron invocations when an env var with exactly that
 * name exists — any other name would have to be wired into the header by hand in the Vercel
 * cron UI on every deployment.
 */
async function handleCron(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Unlike the user-facing routes, cron can fire before any user has ever connected
    // Canvas — in which case the tables syncAllDueConnections() queries don't exist yet.
    await ensureCanvasSchema();
    await syncAllDueConnections();
    return Response.json({ status: 'success' });
  } catch (err) {
    console.error('Canvas cron sync failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest)  { return handleCron(req); }
export async function POST(req: NextRequest) { return handleCron(req); }
