import { auth } from '@/auth';
import { buildDashboardSummary } from '@/lib/dashboard/summary';

export const dynamic = 'force-dynamic';

/** The dashboard's client-side retry. The page itself calls buildDashboardSummary directly. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await buildDashboardSummary(Number(session.user.id)));
}
