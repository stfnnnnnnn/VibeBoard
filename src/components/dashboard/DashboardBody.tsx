'use client';
import { Suspense, use, useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import type { DashboardSummary } from '@/lib/dashboard/types';
import TodayStrip from './TodayStrip';
import QuoteRow from './QuoteRow';
import WeatherRow from './WeatherRow';
import ModuleTile, { Chip } from './ModuleTile';
import WorkboardStrip from './WorkboardStrip';
import { useEntranceMotion } from './useMotion';

const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;
const FIN_DOT = { on_track: '#2fb47a', tight: '#f0a35c', over: '#e0607e' } as const;

/** Unwraps the server's summary promise (or a retried copy) for one Suspense slot. */
function Live({ promise, override, children }: {
  promise: Promise<DashboardSummary>; override: DashboardSummary | null; children: (s: DashboardSummary) => ReactNode;
}) {
  const s = override ?? use(promise);
  return <>{children(s)}</>;
}

const ChipSkeleton = () => <span className="db-skel" style={{ width: 96, height: 24, borderRadius: 999 }} />;

export default function DashboardBody({ summary }: { summary: Promise<DashboardSummary> }) {
  const [override, setOverride] = useState<DashboardSummary | null>(null);
  const [retrying, setRetrying] = useState(false);
  const animate = useEntranceMotion();

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      const r = await fetch('/api/dashboard/summary', { cache: 'no-store' });
      if (r.ok) setOverride(await r.json());
    } catch {
      // Network or JSON failure: keep the current state; the error card stays up for another try.
    } finally { setRetrying(false); }
  }, []);

  const slot = (fallback: ReactNode, render: (s: DashboardSummary) => ReactNode) => (
    <Suspense fallback={fallback}><Live promise={summary} override={override}>{render}</Live></Suspense>
  );

  return (
    <>
      <section className="db-band db-enter" style={{ '--i': 0 } as CSSProperties} aria-label="Today">
        {slot(<TodayStrip s={null} animate={false} onRetry={retry} retrying={retrying} />,
          s => <TodayStrip s={s} animate={animate && !override} onRetry={retry} retrying={retrying} />)}
        <div className="db-side">
          <QuoteRow />
          <WeatherRow />
        </div>
      </section>

      <section className="db-tiles" aria-label="Modules">
        <ModuleTile index={1} href="/studypulse" src="/studypulse.png" name="Study Pulse"
          chip={slot(<ChipSkeleton />, s => !s.study.ok ? <Chip dot="#9aa5b8">—</Chip>
            : s.study.data && <Chip dot="#74bcd9">GPA proj. {s.study.data.gpa.toFixed(2)}</Chip>)} />
        <ModuleTile index={2} href="/finance" src="/financetracker.png" name="Finance Tracker"
          chip={slot(<ChipSkeleton />, s => !s.finance.ok ? <Chip dot="#9aa5b8">—</Chip>
            : s.finance.data && <Chip dot={FIN_DOT[s.finance.data.tone]}>{peso(s.finance.data.safeTotal)} left</Chip>)} />
        <ModuleTile index={3} href="/habits" src="/habittracker.png" name="Habit Tracker"
          chip={slot(<ChipSkeleton />, s => !s.habits.ok ? <Chip dot="#9aa5b8">—</Chip>
            : s.habits.data && s.habits.data.bestStreak > 0 && <Chip dot="#f2a7c0">🔥 {s.habits.data.bestStreak}-day streak</Chip>)} />
      </section>

      {slot(<WorkboardStrip sec={undefined} onRetry={retry} retrying={retrying} />,
        s => <WorkboardStrip sec={s.workboard} onRetry={retry} retrying={retrying} />)}
    </>
  );
}
