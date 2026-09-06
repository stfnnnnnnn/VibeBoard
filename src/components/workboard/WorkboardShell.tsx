'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, List, Columns3, GanttChart, CalendarDays } from 'lucide-react';
import WorkboardWeekView from './WorkboardWeekView';
import WorkListView from './views/WorkListView';
import type { WorkboardWeek } from '@/lib/workboard/aggregate';
import type { WorkItem, ProjectSummary } from '@/lib/workboard/workItems';
import type { WorkStats, WorkloadDay } from '@/lib/workboard/workStats';

export interface WorkPayload {
  items:         WorkItem[];
  projects:      ProjectSummary[];
  generated_at:  string;
  week_start:    string;
  stats:         WorkStats;
  workload:      WorkloadDay[];
}

export type ViewKey = 'list' | 'board' | 'timeline' | 'calendar';

const VIEWS: { key: ViewKey; label: string; Icon: typeof List }[] = [
  { key: 'list',     label: 'List',     Icon: List },
  { key: 'board',    label: 'Board',    Icon: Columns3 },
  { key: 'timeline', label: 'Timeline', Icon: GanttChart },
  { key: 'calendar', label: 'Calendar', Icon: CalendarDays },
];

export default function WorkboardShell(
  { initialWeek, initialWork }: { initialWeek: WorkboardWeek; initialWork: WorkPayload },
) {
  const [view, setView] = useState<ViewKey>('list');
  const [work, setWork] = useState<WorkPayload>(initialWork);

  /** Re-pulls the whole work payload. Called after any mutation so stats, the workload
   *  chart, and every view stay consistent without each one tracking its own deltas. */
  const refreshWork = async () => {
    const res = await fetch('/api/workboard/work');
    if (res.ok) setWork(await res.json());
  };

  return (
    <div className="vb-bg min-h-screen pb-10" style={{ padding: '40px 5%', fontFamily: "'Inter','DM Sans','Segoe UI',sans-serif" }}>
      <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#5c6b80', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none', marginBottom: '14px' }}>
        <ArrowLeft size={15} /> Dashboard
      </Link>

      <h1 className="gradient-text" style={{ fontSize: '2.2rem', fontWeight: 700, margin: '0 0 4px' }}>Workboard</h1>
      <p style={{ margin: '0 0 22px', color: '#5c6b80', fontSize: '0.95rem' }}>All your work, in one place.</p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap' }}>
        {VIEWS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setView(key)}
            aria-pressed={view === key}
            className="vb-view-switch-btn"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              minHeight: '40px', borderRadius: '999px', padding: '8px 14px',
              border: view === key ? 'none' : '1px solid rgba(200,210,230,0.5)',
              fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
              background: view === key ? '#256f92' : 'rgba(255,255,255,0.5)',
              color: view === key ? '#fff' : '#5c6b80',
              transition: 'background 150ms ease, color 150ms ease',
            }}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {view === 'calendar' && <WorkboardWeekView initialWeek={initialWeek} />}
      {view === 'list' && <WorkListView work={work} onChanged={refreshWork} />}
      {(view === 'board' || view === 'timeline') && (
        <p style={{ color: '#8a94a6', fontSize: '0.9rem' }}>
          {work.items.length} work item{work.items.length === 1 ? '' : 's'} loaded.
        </p>
      )}

      <style jsx>{`
        .vb-view-switch-btn:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
