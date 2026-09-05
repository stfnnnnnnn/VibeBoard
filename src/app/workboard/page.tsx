import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ensureWorkboardSchema } from '@/lib/migrate';
import { getWorkboardWeek, mondayOf } from '@/lib/workboard/aggregate';
import WorkboardWeekView from '@/components/workboard/WorkboardWeekView';

export default async function WorkboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  await ensureWorkboardSchema();
  const userId = parseInt(session.user.id);
  const weekStart = mondayOf(new Date());
  const week = await getWorkboardWeek(userId, weekStart);

  return <WorkboardWeekView initialWeek={week} />;
}
