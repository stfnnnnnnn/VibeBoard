import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import GwaCalculator from '@/components/studypulse/GwaCalculator';

export default async function GwaCalculatorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  return <GwaCalculator />;
}
