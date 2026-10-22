import { Suspense } from 'react';
import type { Viewport } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import FinanceShell from '@/components/finance/FinanceShell';
import FinanceSkeleton from '@/components/finance/FinanceSkeleton';
import '../workboard/workboard.css';
import './finance.css';

/* viewport-fit=cover lets the docked composer and the bottom sheet pad themselves clear of the
   home indicator with env(safe-area-inset-*); without it those insets are always 0. */
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function FinancePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const firstName = session.user.name?.split(' ')[0] ?? 'Student';
  return (
    <Suspense fallback={<FinanceSkeleton />}>
      <FinanceShell firstName={firstName} />
    </Suspense>
  );
}
