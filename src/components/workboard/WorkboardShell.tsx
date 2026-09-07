'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, List, Columns3, GanttChart, CalendarDays, Search } from 'lucide-react';
import WorkboardWeekView from './WorkboardWeekView';
import WorkListView from './views/WorkListView';
import WorkBoardView from './views/WorkBoardView';
import WorkTimelineView from './views/WorkTimelineView';
import WorkboardStats from './WorkboardStats';
import WorkboardRail from './WorkboardRail';
import WorkItemDialog, { type DialogTarget } from './WorkItemDialog';
import type { WorkboardWeek } from '@/lib/workboard/aggregate';
import type { WorkItem, ProjectSummary } from '@/lib/workboard/workItems';
// `WORK_CATEGORIES`/`WorkCategory` come from `workCategories.ts`, not `workItems.ts` — the
// latter imports `@/lib/db` (mysql2), which cannot be bundled into this client component.
import { WORK_CATEGORIES, type WorkCategory } from '@/lib/workboard/workCategories';
import type { WorkStats, WorkloadDay } from '@/lib/workboard/workStats';
import { dueDateOf } from '@/lib/workboard/dates';

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

type CategoryFilter = WorkCategory | 'all';

const CATEGORY_LABEL: Record<WorkCategory, string> = {
  academic:     'Academic',
  project:      'Projects',
  organization: 'Organization',
  life:         'Life',
};

/** Direction doc §13: five tabs, "My Work" first (the combined/all-categories tab, gradient
 *  indicator) followed by the four single-category tabs in `WORK_CATEGORIES` order, each with
 *  the neutral `#74bcd9` indicator — deliberately not the category's own chip color (see §13's
 *  rationale: reusing chip hues here would overload them with a second, colliding meaning). */
const CATEGORY_TABS: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'My Work' },
  ...WORK_CATEGORIES.map(c => ({ key: c, label: CATEGORY_LABEL[c] })),
];

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";

export default function WorkboardShell(
  { initialWeek, initialWork }: { initialWeek: WorkboardWeek; initialWork: WorkPayload },
) {
  const [view, setView] = useState<ViewKey>('list');
  const [work, setWork] = useState<WorkPayload>(initialWork);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [dialogTarget, setDialogTarget] = useState<DialogTarget | null>(null);

  /** Re-pulls the whole work payload. Called after any mutation so stats, the workload
   *  chart, and every view stay consistent without each one tracking its own deltas. */
  const refreshWork = async () => {
    const res = await fetch('/api/workboard/work');
    if (res.ok) setWork(await res.json());
  };

  const openCreateDialog = () => setDialogTarget({ mode: 'create' });
  const openEditDialog = (item: WorkItem) => setDialogTarget({ mode: 'edit', item });

  /** Keeps the dialog's project select current the moment a project is created inline,
   *  without waiting for the next `refreshWork()` (which only runs after the item itself
   *  saves — the project can be created and abandoned mid-dialog). */
  const handleProjectCreated = (project: ProjectSummary) => {
    setWork(w => ({
      ...w,
      projects: [...w.projects, project].sort(
        (a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name),
      ),
    }));
  };

  // Stats and the workload chart deliberately read `work.stats` / `work.workload` directly
  // (whole-board numbers, computed server-side) rather than being recomputed from
  // `visibleItems` here — the direction doc and Task 12's brief both require the four stat
  // cards to describe the whole board and stay fixed as the user types or switches tabs.
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return work.items.filter(item => {
      if (category !== 'all' && item.category !== category) return false;
      if (!q) return true;
      return item.title.toLowerCase().includes(q)
          || (item.chip_label ?? '').toLowerCase().includes(q);
    });
  }, [work.items, category, query]);

  const isFiltered = category !== 'all' || query.trim() !== '';

  /** The Overdue card's subtitle wants "oldest from <date>" (direction doc §6's example).
   *  Derived from the whole-board `work.items` (never `visibleItems`) so it never moves as
   *  the user filters — same rule as `stats`/`workload` above. */
  const oldestOverdueDue = useMemo(() => {
    let oldest: string | null = null;
    for (const item of work.items) {
      if (item.work_status === 'done') continue;
      const due = dueDateOf(item);
      if (due === null || due >= work.generated_at) continue;
      if (oldest === null || due < oldest) oldest = due;
    }
    return oldest;
  }, [work.items, work.generated_at]);

  return (
    <div className="vb-bg min-h-screen pb-10" style={{ padding: '40px 5%', fontFamily: "'Inter','DM Sans','Segoe UI',sans-serif" }}>
      <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#5c6b80', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none', marginBottom: '14px' }}>
        <ArrowLeft size={15} /> Dashboard
      </Link>

      <h1 className="gradient-text" style={{ fontSize: '2.2rem', fontWeight: 700, margin: '0 0 4px' }}>Workboard</h1>
      <p style={{ margin: '0 0 22px', color: '#5c6b80', fontSize: '0.95rem' }}>All your work, in one place.</p>

      <WorkboardStats stats={work.stats} oldestOverdueDue={oldestOverdueDue} />

      {/* Category tabs (direction doc §13) — underline-indicator pattern, deliberately not
          the view switcher's pill-fill, so the two "pick one of a few" controls read as
          different jobs (filter vs. view) at a glance. */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid rgba(200,210,230,0.35)', marginBottom: '18px', flexWrap: 'wrap' }}>
        {CATEGORY_TABS.map(({ key, label }) => {
          const active = category === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              aria-pressed={active}
              className="vb-category-tab"
              style={{
                position: 'relative', display: 'inline-flex', alignItems: 'center',
                minHeight: '40px', padding: '10px 16px', background: 'transparent', border: 'none',
                fontFamily: FONT, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
                color: active ? '#2d3748' : '#5c6b80',
              }}
            >
              {label}
              <span
                aria-hidden
                style={{
                  position: 'absolute', left: 0, right: 0, bottom: '-1px', height: '2px',
                  background: !active ? 'transparent' : key === 'all'
                    ? 'linear-gradient(to right, #f2a7c0, #74bcd9)'
                    : '#74bcd9',
                }}
              />
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="vb-btn-pink"
            onClick={openCreateDialog}
            style={{ width: 'auto', minHeight: '40px', padding: '8px 18px', boxSizing: 'border-box' }}
          >
            New Work Item
          </button>

          <div style={{ position: 'relative', minWidth: '220px' }}>
            <Search size={15} color="#8a94a6" aria-hidden style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              type="search"
              className="vb-work-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search work items…"
              aria-label="Search work items"
              style={{
                width: '100%', minHeight: '40px', boxSizing: 'border-box', borderRadius: '999px',
                padding: '8px 14px 8px 36px', background: 'rgba(255,255,255,0.5)',
                border: '1px solid rgba(200,210,230,0.5)', fontFamily: FONT, fontSize: '0.82rem',
                fontWeight: 500, color: '#2d3748',
              }}
            />
          </div>
        </div>
      </div>

      {/* Direction doc §10/§12: the rail sits beside List/Calendar (fixed 240px column) and
          collapses entirely on Board/Timeline so kanban columns and the date axis get the
          full canvas rather than degrading under a squeeze. */}
      <div style={{ display: 'flex', gap: '18px', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          {view === 'calendar' && <WorkboardWeekView initialWeek={initialWeek} />}
          {view === 'list' && (
            <WorkListView
              items={visibleItems}
              todayStr={work.generated_at}
              isFiltered={isFiltered}
              onChanged={refreshWork}
              onEdit={openEditDialog}
              onNewItem={openCreateDialog}
            />
          )}
          {view === 'board' && (
            <WorkBoardView
              items={visibleItems}
              todayStr={work.generated_at}
              isFiltered={isFiltered}
              onChanged={refreshWork}
              onNewItem={openCreateDialog}
            />
          )}
          {view === 'timeline' && (
            <WorkTimelineView
              items={visibleItems}
              weekStart={work.week_start}
              today={work.generated_at}
            />
          )}
        </div>

        {(view === 'list' || view === 'calendar') && (
          // Whole-board data (`work.workload` / `work.items`), never `visibleItems` — the
          // rail describes the whole board, same rule the stat cards follow, so its numbers
          // never move as the user types in search or switches category tabs.
          <WorkboardRail workload={work.workload} items={work.items} todayStr={work.generated_at} />
        )}
      </div>

      {dialogTarget && (
        <WorkItemDialog
          target={dialogTarget}
          projects={work.projects}
          onClose={() => setDialogTarget(null)}
          onSaved={refreshWork}
          onProjectCreated={handleProjectCreated}
        />
      )}

      <style jsx>{`
        .vb-view-switch-btn:focus-visible,
        .vb-category-tab:focus-visible,
        .vb-work-search:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
          border-radius: inherit;
        }
      `}</style>
    </div>
  );
}
