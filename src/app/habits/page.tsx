import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import HabitsDashboard from '@/components/habits/HabitsDashboard';

export default async function HabitsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const firstName = session.user.name?.split(' ')[0] ?? 'Student';

  return <HabitsDashboard firstName={firstName} />;
}
