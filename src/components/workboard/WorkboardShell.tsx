'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, List, Table2, Columns3, GanttChart, CalendarDays, Search } from 'lucide-react';
import WorkboardWeekView from './WorkboardWeekView';
import WorkListView from './views/WorkListView';
import WorkBoardView from './views/WorkBoardView';
import WorkTableView from './views/WorkTableView';
import WorkTimelineView from './views/WorkTimelineView';
import WorkboardStats from './WorkboardStats';
import WorkboardRail from './WorkboardRail';
import WorkItemDialog, { type DialogTarget } from './WorkItemDialog';
import WorkItemDetail from './WorkItemDetail';
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

export type ViewKey = 'list' | 'table' | 'board' | 'timeline' | 'calendar';

const VIEWS: { key: ViewKey; label: string; Icon: typeof List }[] = [
  { key: 'list',     label: 'List',     Icon: List },
  // Spec §7-§9's central new feature, placed directly after Focus/List because it is the other
  // "work through everything" surface — the spec's own Views section lists it in exactly this
  // position. Calendar keeps its slot until the task that removes it from the selector.
  { key: 'table',    label: 'Table',    Icon: Table2 },
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

/** Direction-addendum §14b: the context row — and *only* the context row — flips to the app's
 *  titling face as it moves into the header, because it is now part of the title block. A second
 *  constant rather than an edit to `FONT` above: `FONT` is also on the toolbar row's search input
 *  (Inter, the UI face), which §14a explicitly keeps as one of the five axes separating the two
 *  "pick one of a few" rows — changing the shared constant would silently move that too. */
const CONTEXT_FONT = "'DM Sans','Segoe UI',sans-serif";

/** Direction doc §11's outer-panel glass treatment, matched to `WorkboardWeekView.tsx`'s and
 *  `WorkboardRail.tsx`'s `GLASS` constant exactly (same values, duplicated rather than
 *  imported — each of the three files stays independent of the others so none of them risks
 *  acquiring a runtime import path into `aggregate.ts`/`workItems.ts`, both of which pull in
 *  `pool` (mysql2) at module scope and would 500 this page if reached from a client bundle). */
const GLASS: React.CSSProperties = {
  background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
  borderRadius: '22px', border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 8px 24px rgba(31,38,68,0.09)',
};

/** Roving-tabindex arrow-key navigation shared by the view switcher (a true tablist — see
 *  its own comment below) and the category filter (a radiogroup — see its comment below).
 *  Both are single-select button rows of the same shape: Right/Down moves to the next
 *  control, Left/Up to the previous, Home/End to the first/last, wrapping at the ends. Moving
 *  focus also activates the newly-focused control in both patterns (automatic activation for
 *  tabs; native radio-button behavior for the radiogroup), so `activate` both updates state
 *  and is immediately followed by moving DOM focus to the same index. */
function handleRovingKeyDown(
  e: React.KeyboardEvent,
  idx: number,
  count: number,
  refs: React.MutableRefObject<(HTMLButtonElement | null)[]>,
  activate: (nextIndex: number) => void,
) {
  let next: number | null = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % count;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + count) % count;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = count - 1;
  if (next === null) return;
  e.preventDefault();
  activate(next);
  refs.current[next]?.focus();
}

export default function WorkboardShell(
  { initialWeek, initialWork }: { initialWeek: WorkboardWeek; initialWork: WorkPayload },
) {
  const [view, setView] = useState<ViewKey>('list');
  const [work, setWork] = useState<WorkPayload>(initialWork);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [dialogTarget, setDialogTarget] = useState<DialogTarget | null>(null);
  /** The item whose detail drawer is open, or null. Same shape and same lifetime as
   *  `dialogTarget` above — the drawer is the dialog's sibling, not a second kind of state. */
  const [detailItem, setDetailItem] = useState<WorkItem | null>(null);
  const viewTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const categoryTabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /** Re-pulls the whole work payload. Called after any mutation so stats, the workload
   *  chart, and every view stay consistent without each one tracking its own deltas. */
  const refreshWork = async () => {
    const res = await fetch('/api/workboard/work');
    if (res.ok) setWork(await res.json());
  };

  const openCreateDialog = () => setDialogTarget({ mode: 'create' });
  const openEditDialog = (item: WorkItem) => setDialogTarget({ mode: 'edit', item });

  const openDetail = (item: WorkItem) => setDetailItem(item);
  const closeDetail = () => setDetailItem(null);

  /** The open item as the *current* payload knows it, not as it was when the title was clicked.
   *
   *  The drawer's own writes (a status change, every subtask mutation) end in `refreshWork`, and
   *  the captured object is a snapshot from before them — a drawer rendering it would show the
   *  stale status it just changed. Looked up by `source`+`id`, the pair that identifies a row
   *  across the whole module (ids repeat between the four Study Pulse tables, so neither half is
   *  a key on its own). Falls back to the snapshot when the lookup misses, which is what keeps
   *  an item filtered out from under the drawer — a search typed behind it, or a completed item
   *  leaving List's groups — from blanking the panel the user is still reading. */
  const detailLive = detailItem === null
    ? null
    : work.items.find(i => i.source === detailItem.source && i.id === detailItem.id) ?? detailItem;

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
  /** The narrower half of `isFiltered`. The Table has three empty states rather than two, and
   *  `isFiltered` alone cannot separate "this context has no work yet" (where offering the
   *  create button is right) from "the search matched nothing in this context" (where it is
   *  not), because it is true for every non-My-Work tab regardless of the search box. */
  const isSearching = query.trim() !== '';

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

      {/* Spec §1 / addendum §14: the header block is the title on the left and the context
          navigation on the upper right, on one row where width allows. The 22px that used to be
          the subtitle's own bottom margin lives on this row instead, so the context group's
          `align-self: flex-end` lands on the subtitle's text baseline rather than 22px below it.
          `flex-wrap` here is only a graceful fallback for narrow viewports; addendum §21 assigns
          the real 768–1023px wrap and the <768px scroll-strip treatment to Task 40. */}
      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: '22px' }}>
        <div>
          <h1 className="gradient-text" style={{ fontSize: '2.2rem', fontWeight: 700, margin: '0 0 4px' }}>Workboard</h1>
          <p style={{ margin: 0, color: '#5c6b80', fontSize: '0.95rem' }}>All your work, in one place.</p>
        </div>

        {/* Context navigation (direction doc §13, addendum §14) — underline-indicator pattern,
            deliberately not the view switcher's pill-fill, so the two "pick one of a few"
            controls read as different jobs (filter vs. view) at a glance. §14a makes that
            distinction carry on five axes at once now that the rows sit far apart: shape,
            active signal, resting boundary, typeface (DM Sans here, Inter there) and position.

            Deliberately `role="radiogroup"`/`role="radio"`, not the tabs pattern: this row picks
            a *filter* applied to whichever view is showing, it doesn't switch to a distinct
            content panel the way the view switcher below does. The WAI-ARIA tabs pattern assumes
            each tab owns an associated (and otherwise hidden) tabpanel; there is no second panel
            here for "Academic" to own — the same List/Board/Timeline/Calendar panel just renders
            a narrower slice of `work.items`. A single-select group of otherwise-plain buttons is
            exactly what `radiogroup`/`radio` describes, and `aria-checked` says "selected", which
            is what `aria-pressed` here was always straining to mean.

            `align-self: flex-end` is §14b's exact instruction for keeping the group shrink-to-fit
            and bottom-aligned against the title: a `width: 100%` group under a right-aligned row
            would read as a page divider rather than as this control's own baseline. For the same
            reason the row no longer carries a bottom margin of its own — inside a flex row, a
            bottom margin under `align-self: flex-end` would lift the underline off the baseline
            it is supposed to share with the title block. */}
        <div role="radiogroup" aria-label="Filter by context" style={{ alignSelf: 'flex-end', display: 'flex', gap: '4px', borderBottom: '1px solid rgba(200,210,230,0.35)', flexWrap: 'wrap' }}>
          {CATEGORY_TABS.map(({ key, label }, idx) => {
            const active = category === key;
            return (
              <button
                key={key}
                ref={el => { categoryTabRefs.current[idx] = el; }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setCategory(key)}
                onKeyDown={e => handleRovingKeyDown(e, idx, CATEGORY_TABS.length, categoryTabRefs, next => setCategory(CATEGORY_TABS[next].key))}
                className="vb-category-tab"
                style={{
                  position: 'relative', display: 'inline-flex', alignItems: 'center',
                  minHeight: '40px', padding: '10px 16px', background: 'transparent', border: 'none',
                  // §14b: DM Sans (the title block's face, now that this row is part of it) and an
                  // explicit `letter-spacing: 0`, so §1's 0.04em uppercase tracking can never be
                  // inherited onto these sentence-case labels. Weight stays 700 in both states.
                  fontFamily: CONTEXT_FONT, letterSpacing: '0',
                  fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
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
      </div>

      <WorkboardStats stats={work.stats} oldestOverdueDue={oldestOverdueDue} />

      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* True tabs pattern: each button selects one of four mutually-exclusive, entirely
            different content panels (List/Board/Timeline/Calendar all render into the single
            `role="tabpanel"` below), which is exactly the case the WAI-ARIA tabs pattern is
            for — unlike the category filter above. `aria-label` on every button is what keeps
            the accessible name intact once the label text is visually hidden below 1024px
            (direction doc §10: "icon-only", label hidden, name retained); it also means the
            visible `<span>` text is redundant to a screen reader at every width, which is fine
            since `aria-label` always wins over visible content for the accessible name. */}
        <div role="tablist" aria-label="Workboard view" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {VIEWS.map(({ key, label, Icon }, idx) => (
            <button
              key={key}
              ref={el => { viewTabRefs.current[idx] = el; }}
              id={`vb-view-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={view === key}
              aria-controls="vb-view-panel"
              tabIndex={view === key ? 0 : -1}
              aria-label={label}
              title={label}
              onClick={() => setView(key)}
              onKeyDown={e => handleRovingKeyDown(e, idx, VIEWS.length, viewTabRefs, next => setView(VIEWS[next].key))}
              className="vb-view-switch-btn"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                minHeight: '40px', borderRadius: '999px',
                border: view === key ? 'none' : '1px solid rgba(200,210,230,0.5)',
                fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                background: view === key ? '#256f92' : 'rgba(255,255,255,0.5)',
                color: view === key ? '#fff' : '#5c6b80',
                transition: 'background 150ms ease, color 150ms ease',
              }}>
              <Icon size={16} aria-hidden /> <span className="vb-view-switch-label">{label}</span>
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

      {/* Direction doc §10/§12: the rail sits beside List/Calendar (fixed 240px column) at
          >=1024px, collapses entirely on Board/Timeline so kanban columns and the date axis
          get the full canvas, and — new in this task — moves below the main content (instead
          of beside it) from 1023px down on List/Calendar, where it stays visible rather than
          collapsing. Both `flex-direction` and `align-items` are kept out of the inline style
          below and set only in the stylesheet (same specificity reasoning as elsewhere in this
          task): `align-items: flex-start` cross-aligns the two side-by-side columns to their
          own content height at >=1024px, but that same value would shrink-wrap both children
          to their own content *width* once the row becomes a column below 1024px — a plain
          class rule can't override an inline `alignItems` to fix that, so the value has to live
          here from the start. `WorkboardRail.tsx` separately owns its own `flex`/`width`
          override for the stacked case. */}
      <div className="vb-content-row" style={{ display: 'flex', gap: '18px' }}>
        {/* The view switcher's single shared tabpanel — `id`/`aria-labelledby` track whichever
            tab is currently selected. Direction doc §11: List/Board/Timeline share one GLASS
            outer panel (the shell's own view-content container — none of the three views
            apply it themselves, so it's applied once, here, rather than three times); Calendar
            keeps its own existing look (multiple internal glass cells, no single outer panel)
            and is deliberately excluded from this wrapper, per §11's "not being touched". */}
        <div id="vb-view-panel" role="tabpanel" aria-labelledby={`vb-view-tab-${view}`} tabIndex={0} style={{ flex: '1 1 auto', minWidth: 0 }}>
          {view === 'calendar' && <WorkboardWeekView initialWeek={initialWeek} />}
          {view !== 'calendar' && (
            <div style={{ ...GLASS, padding: '20px', boxSizing: 'border-box' }}>
              {view === 'list' && (
                <WorkListView
                  items={visibleItems}
                  todayStr={work.generated_at}
                  isFiltered={isFiltered}
                  onChanged={refreshWork}
                  onEdit={openEditDialog}
                  onOpenDetail={openDetail}
                  onNewItem={openCreateDialog}
                />
              )}
              {view === 'table' && (
                <WorkTableView
                  items={visibleItems}
                  context={category}
                  todayStr={work.generated_at}
                  isFiltered={isFiltered}
                  isSearching={isSearching}
                  onChanged={refreshWork}
                  onNewItem={openCreateDialog}
                  onOpenDetail={openDetail}
                />
              )}
              {view === 'board' && (
                <WorkBoardView
                  items={visibleItems}
                  // The SAME value `visibleItems` is filtered by, deliberately: the Board judges
                  // a drop's stage legality against the board's context rather than each item's
                  // own, which is only sound while the two agree. Task 16 shipped this prop
                  // optional (defaulting to 'all'), so its absence would not have failed the
                  // build — the Board would just have kept My Work's three columns under every
                  // tab, invisibly, until someone opened Projects looking for Backlog.
                  context={category}
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
                  isFiltered={isFiltered}
                />
              )}
            </div>
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

      {/* §26's detail drawer. `onChanged` is the same `refreshWork` the dialog's `onSaved` gets:
          one refresh function, so a subtask checked in here moves the row's progress counts by
          exactly the path a dialog save moves its fields.

          Keyed by the owner pair so opening a *different* item remounts the panel rather than
          reusing it — the drawer holds that item's subtask list and draft text in state, and
          carrying either across two different work items would be a bug the user sees. */}
      {detailLive && (
        <WorkItemDetail
          key={`${detailLive.source}-${detailLive.id}`}
          item={detailLive}
          todayStr={work.generated_at}
          onClose={closeDetail}
          onChanged={refreshWork}
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
        #vb-view-panel:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
          border-radius: 22px;
        }
        /* Direction doc §10: rail moves below main content from 1023px down instead of
           sitting beside it (kept out of the inline style above for the same specificity
           reason documented on .vb-board-col and .vb-rail in their own files). align-items
           switches from flex-start (top-align the two side-by-side columns at their own
           height) to stretch (fill the full row width once stacked into a column) — leaving
           it at flex-start under flex-direction: column would shrink both the view panel and
           the rail down to their own content width instead of the full page width. */
        .vb-content-row {
          align-items: flex-start;
        }
        @media (max-width: 1023px) {
          .vb-content-row {
            flex-direction: column;
            align-items: stretch;
          }
        }
        /* Direction doc §10: the view switcher goes icon-only below 1024px — the label text
           is hidden visually but each button's aria-label (set above) keeps its accessible
           name, so screen-reader users still get "List"/"Board"/etc. rather than nothing. */
        .vb-view-switch-btn {
          padding: 8px 14px;
        }
        @media (max-width: 1023px) {
          .vb-view-switch-label {
            display: none;
          }
          .vb-view-switch-btn {
            padding: 8px 12px;
          }
        }
      `}</style>
    </div>
  );
}
