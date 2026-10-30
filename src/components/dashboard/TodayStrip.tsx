'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { DashboardSummary, Section } from '@/lib/dashboard/types';
import { shortCourseCode } from '@/lib/workboard/ui/courseCode';
import { useCountUp } from './useMotion';

const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;
const TONE_LABEL = { on_track: 'on track', tight: 'tight', over: 'over budget' } as const;

function Count({ value, animate, format = (n: number) => String(Math.round(n)) }: { value: number; animate: boolean; format?: (n: number) => string }) {
  return <>{format(useCountUp(value, animate))}</>;
}

type Props = { s: DashboardSummary | null; animate: boolean; onRetry: () => void; retrying: boolean };

/** Renders one cell for one section: loading, failed, not set up, or live (spec §5.2). */
function Cell<T>({ label, href, sec, setup, onRetry, retrying, children }: {
  label: string; href: string; sec: Section<T | null> | undefined; setup: string;
  onRetry: () => void; retrying: boolean; children: (data: T) => { body: ReactNode; aria: string };
}) {
  if (!sec) {
    return (
      <div className="db-item db-cell" aria-busy="true">
        <span className="db-k">{label}</span>
        <span className="db-skel" style={{ width: '70%', height: 16, marginTop: 3 }} />
        <span className="db-skel" style={{ width: '45%', marginTop: 4 }} />
      </div>
    );
  }
  if (!sec.ok) {
    return (
      <div className="db-item db-cell">
        <span className="db-k">{label}</span>
        <span className="db-err">Couldn&apos;t load</span>
        <button type="button" className="db-retry" onClick={onRetry} disabled={retrying} aria-label={`Retry loading ${label}`}>↻</button>
      </div>
    );
  }
  if (sec.data === null) {
    return (
      <Link href={href} className="db-item db-cell" aria-label={`${label}: set up`}>
        <span className="db-k">{label}</span>
        <span className="db-empty">Set up →</span>
        <span className="db-sub">{setup}</span>
      </Link>
    );
  }
  const { body, aria } = children(sec.data as T);
  return <Link href={href} className="db-item db-cell" aria-label={aria}><span className="db-k">{label}</span>{body}</Link>;
}

export default function TodayStrip({ s, animate, onRetry, retrying }: Props) {
  const wb = s?.workboard;
  // The workboard digest is never null; "not set up" there means no items at all.
  const wbSection = wb === undefined ? undefined
    : !wb.ok ? wb
    : { ok: true as const, data: wb.data.hasAnyItems ? wb.data : null };

  return (
    <div className="db-panel db-today">
      <Cell label="Next class" href="/studypulse/schedule" sec={s?.nextClass} setup="add your schedule" onRetry={onRetry} retrying={retrying}>
        {nc => ({
          aria: `Next class: ${nc.courseCode} at ${nc.timeLabel}, ${nc.when}`,
          body: <>
            <span className="db-v">{shortCourseCode(nc.courseCode)} · {nc.timeLabel}</span>
            <span className="db-sub">{nc.when}{nc.place ? ` · ${nc.place}` : ''}</span>
          </>,
        })}
      </Cell>
      <Cell label="Habits today" href="/habits" sec={s?.habits} setup="add a habit" onRetry={onRetry} retrying={retrying}>
        {h => ({
          aria: h.total ? `Habits today: ${h.done} of ${h.total} done` : 'Habits today: none scheduled',
          body: h.total
            ? <>
                <span className="db-v"><Count value={h.done} animate={animate} /> <small>/ {h.total}</small></span>
                <span className="db-bar"><i style={{ width: `${Math.round((h.done / h.total) * 100)}%` }} /></span>
              </>
            : <><span className="db-v">Rest day</span><span className="db-sub">nothing scheduled</span></>,
        })}
      </Cell>
      <Cell label="Safe to spend" href="/finance" sec={s?.finance} setup="log your allowance" onRetry={onRetry} retrying={retrying}>
        {f => ({
          aria: `Safe to spend today: ${peso(f.perDay)}, ${TONE_LABEL[f.tone]}`,
          body: <>
            <span className="db-v"><Count value={f.perDay} animate={animate} format={peso} /></span>
            <span className="db-sub" data-tone={f.tone}>today · {TONE_LABEL[f.tone]}</span>
          </>,
        })}
      </Cell>
      <Cell label="Due this week" href="/workboard" sec={wbSection} setup="add work" onRetry={onRetry} retrying={retrying}>
        {d => ({
          aria: `Due this week: ${d.dueThisWeek}${d.overdue ? `, ${d.overdue} late` : ''}`,
          body: <>
            <span className="db-v">
              <Count value={d.dueThisWeek} animate={animate} />
              {d.overdue > 0 && <span className="db-late"> · {d.overdue} late</span>}
            </span>
            <span className="db-sub">{d.upNext[0] ? `next: ${d.upNext[0].title}` : 'all clear'}</span>
          </>,
        })}
      </Cell>
    </div>
  );
}
