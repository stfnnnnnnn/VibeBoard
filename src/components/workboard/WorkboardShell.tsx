'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, List, Table2, Columns3, GanttChart, Search, Plus } from 'lucide-react';
import WorkListView from './views/WorkListView';
import WorkBoardView from './views/WorkBoardView';
import WorkTableView from './views/WorkTableView';
import WorkTimelineView from './views/WorkTimelineView';
import WorkboardStats from './WorkboardStats';
import WorkItemDialog, { type DialogTarget } from './WorkItemDialog';
import WorkItemDetail from './WorkItemDetail';
import NewItemTypeChooser, { type NewItemType } from './NewItemTypeChooser';
import WorkboardEventDialog, { type EventDialogTarget } from './WorkboardEventDialog';
import CommandPalette from './CommandPalette';
import WbToaster from './ui/WbToaster';
import { QuickAddFullDialogContext } from './ui/WbQuickAdd';
import { usePresence } from './ui/WbOverlay';
import WbSegmented from './ui/WbSegmented';
import { useBulkActions, bulkStatusOptions } from './useBulkActions';
import { itemKey } from '@/lib/workboard/ui/itemKey';
// Spec §23's Filters popover. `matchesFilters` is the pure predicate this shell composes into
// `visibleItems` below — the popover owns the panel's UI, this file owns where the result is
// applied, so all four views keep filtering through exactly one memo.
import WorkboardFilters, {
  EMPTY_FILTERS, countActiveFilters, matchesFilters, type FilterState,
} from './WorkboardFilters';
import type { WorkboardWeek, WorkboardEventItem } from '@/lib/workboard/aggregate';
import type { WorkItem, ProjectSummary } from '@/lib/workboard/workItems';
// `WORK_CATEGORIES`/`WorkCategory` come from `workCategories.ts`, not `workItems.ts` — the
// latter imports `@/lib/db` (mysql2), which cannot be bundled into this client component.
import { WORK_CATEGORIES, type WorkCategory } from '@/lib/workboard/workCategories';
import type { WorkStats, WorkloadDay } from '@/lib/workboard/workStats';
import { oldestOverdueDue as oldestOverdueDueOf } from '@/lib/workboard/ui/kpiSeries';
import { courseOptions } from '@/lib/workboard/ui/quickAdd';

export interface WorkPayload {
  items:         WorkItem[];
  projects:      ProjectSummary[];
  generated_at:  string;
  week_start:    string;
  stats:         WorkStats;
  workload:      WorkloadDay[];
}

/** Spec §5/§6's view set: Focus | Table | Board | Timeline. Calendar is deliberately absent —
 *  what it used to show (class schedule, conflicts, the workload heatmap) is now part of
 *  Timeline's own week view, and `/workboard/calendar` redirects here rather than keeping a
 *  second, narrower copy of the same data. The `list` key is kept as-is while its label reads
 *  "Focus": §4 renames the view in the UI only, and a key rename would cascade through state,
 *  tab `id`s and `WorkListView` for no user-visible gain. */
export type ViewKey = 'list' | 'table' | 'board' | 'timeline';

const VIEWS: { key: ViewKey; label: string; Icon: typeof List }[] = [
  { key: 'list',     label: 'Focus',    Icon: List },
  // Spec §7-§9's central new feature, placed directly after Focus because it is the other
  // "work through everything" surface — the spec's own Views section lists it in exactly this
  // position.
  { key: 'table',    label: 'Table',    Icon: Table2 },
  { key: 'board',    label: 'Board',    Icon: Columns3 },
  { key: 'timeline', label: 'Timeline', Icon: GanttChart },
];

type CategoryFilter = WorkCategory | 'all';

const CATEGORY_LABEL: Record<WorkCategory, string> = {
  academic:     'Academic',
  project:      'Projects',
  organization: 'Organization',
  life:         'Life',
};

/** Direction doc §13: five tabs, "My Work" first (the combined/all-categories tab) followed by
 *  the four single-category tabs in `WORK_CATEGORIES` order. Every tab shares one
 *  `--wb-pink-strong` underline (refine spec §4) — deliberately not the category's own chip
 *  color (§13: reusing chip hues here would overload them with a second, colliding meaning). */
const CATEGORY_TABS: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'My Work' },
  ...WORK_CATEGORIES.map(c => ({ key: c, label: CATEGORY_LABEL[c] })),
];

/** `display` is in the stylesheet: one of the two New item buttons is hidden at each width.
 *  The fill, padding and type come from `.wb-btn-primary`. */
const NEW_ITEM_STYLE: React.CSSProperties = {
  minHeight: 40, boxSizing: 'border-box', whiteSpace: 'nowrap',
};

/** Long header date: "Tuesday, October 20". Local-midnight parse of a "YYYY-MM-DD" string. */
function formatLongDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Roving-tabindex arrow-key navigation for the context radiogroup (the view switcher's own
 *  keyboard handling now lives in `WbSegmented`): Right/Down moves to the next control,
 *  Left/Up to the previous, Home/End to the first/last, wrapping at the ends. Moving focus also
 *  activates the newly-focused control (native radio-button behaviour), so `activate` updates
 *  state and is immediately followed by moving DOM focus to the same index. */
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

/** Spec 4.3: an overlay opened from the keyboard appears without animation. Rather than thread
 *  the triggering event through every view's `onEdit`/`onNewItem` callback, the shell tracks the
 *  last input modality: a keydown (including the Enter/Space that fires a keyboard click, whose
 *  `detail` is 0) marks keyboard, a pointerdown clears it. Capture phase, so it is current before
 *  any handler that opens an overlay runs. */
function useKeyboardIntent(): React.MutableRefObject<boolean> {
  const ref = useRef(false);
  useEffect(() => {
    const onKey = () => { ref.current = true; };
    const onPointer = () => { ref.current = false; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
  return ref;
}

/** An overlay's target plus whether it was opened from the keyboard, captured at open time so the
 *  exit window (usePresence) keeps the same `instant` it entered with. */
type Opened<T> = { target: T; instant: boolean };

export default function WorkboardShell(
  { initialWeek, initialWork }: { initialWeek: WorkboardWeek; initialWork: WorkPayload },
) {
  const [view, setView] = useState<ViewKey>('list');
  const [work, setWork] = useState<WorkPayload>(initialWork);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  /** The Filters popover's state, owned here rather than inside the popover so `visibleItems`
   *  can read it — the popover is the editor, this is the value every view filters by. */
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  /** The page's one navigable week, shared by Timeline and the Focus week picker (plan R4):
   *  paging either pages both. Independent of `work.week_start` (the whole board's fixed
   *  Monday, used by the stat cards), since paging a week must never move a number that
   *  describes the whole board. Seeded from the server-rendered payload `page.tsx` fetches. */
  const [week, setWeek] = useState<WorkboardWeek>(initialWeek);
  const [weekLoading, setWeekLoading] = useState(false);
  const keyboardIntent = useKeyboardIntent();
  const [dialogState, setDialogState] = useState<Opened<DialogTarget> | null>(null);
  const setDialogTarget = (target: DialogTarget | null) =>
    setDialogState(target && { target, instant: keyboardIntent.current });
  // Keeps the dialog mounted through its exit transition (WbOverlay's `open` goes false first).
  const dlg = usePresence(dialogState);
  /** "New Work Item" opens this first, not `dialogTarget` directly — a Task and an
   *  Event/Reminder are different tables behind one button (see `NewItemTypeChooser`'s own
   *  doc), so the button's first job is finding out which the user means. `true` only while
   *  this initial choice is showing; the moment one is made it closes and hands off to
   *  `dialogTarget` (Task) or `eventDialogTarget` (Event/Reminder) below. */
  const [typeChooser, setTypeChooser] = useState<{ instant: boolean } | null>(null);
  const setTypeChooserOpen = (isOpen: boolean) =>
    setTypeChooser(isOpen ? { instant: keyboardIntent.current } : null);
  const chooser = usePresence(typeChooser);
  /** `dialogTarget`'s sibling for the other table `openCreateDialog` can now reach —
   *  `workboard_items`, via `WorkboardEventDialog`. Also opened directly (skipping the
   *  chooser) when Timeline's `EventCard` is clicked to edit one that already exists, since at
   *  that point the type is already settled by which row was clicked. */
  const [eventDialogState, setEventDialogState] = useState<Opened<EventDialogTarget> | null>(null);
  const setEventDialogTarget = (target: EventDialogTarget | null) =>
    setEventDialogState(target && { target, instant: keyboardIntent.current });
  const evd = usePresence(eventDialogState);
  /** The item whose detail drawer is open, or null. Same shape and same lifetime as
   *  `dialogTarget` above — the drawer is the dialog's sibling, not a second kind of state. */
  const [detailItem, setDetailItem] = useState<WorkItem | null>(null);
  /** Captured at open (not reset on close), so the exit window keeps the value it entered with. */
  const [detailInstant, setDetailInstant] = useState(false);
  const categoryTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** The phone tab strip's right-edge fade is a scroll cue, so it goes once the strip is at its end
   *  (or never overflowed). Re-checked on scroll and resize. */
  const contextNavRef = useRef<HTMLDivElement | null>(null);
  const [contextNavAtEnd, setContextNavAtEnd] = useState(false);
  const checkContextNavEnd = useCallback(() => {
    const el = contextNavRef.current;
    if (el) setContextNavAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);
  useEffect(() => {
    checkContextNavEnd();
    window.addEventListener('resize', checkContextNavEnd);
    return () => window.removeEventListener('resize', checkContextNavEnd);
  }, [checkContextNavEnd]);

  /** Spec 13's Ctrl+K palette. `instant` is true when Ctrl+K (or a keyboard-activated trigger)
   *  opened it, false for a pointer click on the hint chip or the phone search button. */
  const [palette, setPalette] = useState<{ instant: boolean; id: number } | null>(null);
  const pal = usePresence(palette, 100);
  // Each open gets a fresh id (the palette's key), so a reopen inside the exit window starts empty.
  const paletteSeq = useRef(0);
  /** The last five items opened in the drawer or the edit dialog, newest first: the palette's Recent. */
  const [recentKeys, setRecentKeys] = useState<string[]>([]);
  const pushRecent = (item: WorkItem) => {
    const key = itemKey(item);
    setRecentKeys(r => [key, ...r.filter(k => k !== key)].slice(0, 5));
  };
  const openPalette = (viaKeyboard: boolean) => setPalette({ instant: viaKeyboard, id: ++paletteSeq.current });

  /** Read by the Ctrl+K listener (bound once), so kept current every render below. */
  const paletteOpenRef = useRef(false);
  const modalOpenRef = useRef(false);
  paletteOpenRef.current = palette !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      // e.code covers layouts where the K key does not produce a latin k.
      if (e.key.toLowerCase() !== 'k' && e.code !== 'KeyK') return;
      if (e.repeat) return;
      if (paletteOpenRef.current) { e.preventDefault(); setPalette(null); return; }
      // Never stack the palette over a dialog, the chooser or the drawer.
      if (modalOpenRef.current) return;
      e.preventDefault();
      setPalette({ instant: true, id: ++paletteSeq.current });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Re-pulls the whole work payload. Called after any mutation so stats, the workload
   *  chart, and every view stay consistent without each one tracking its own deltas. */
  const refreshSeq = useRef(0);
  const refreshWork = async () => {
    // Latest request wins: a slower, older response must not overwrite a newer one
    // (complete() and its Undo each refresh, and the two can resolve out of order).
    // Never rejects: callers await this after a write that already landed (and then offer
    // Undo), so a failed refresh just leaves the current payload in place.
    const seq = ++refreshSeq.current;
    try {
      const res = await fetch('/api/workboard/work');
      if (!res.ok) return;
      const next: WorkPayload = await res.json();
      if (seq === refreshSeq.current) setWork(next);
    } catch {
      // Offline or a non-JSON body: keep the current payload.
    }
  };

  /** Spec §12 bulk actions. `hiddenKeys` hides rows whose delete is waiting out its Undo
   *  window; `selectionCount` lifts the toaster above the bulk bar while anything is selected. */
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const hide = useCallback((keys: string[]) => setHiddenKeys(s => { const n = new Set(s); keys.forEach(k => n.add(k)); return n; }), []);
  const unhide = useCallback((keys: string[]) => setHiddenKeys(s => { const n = new Set(s); keys.forEach(k => n.delete(k)); return n; }), []);
  const [selectionCount, setSelectionCount] = useState(0);
  const bulk = useBulkActions({ refresh: refreshWork, hide, unhide });
  // Handed to Table (Task 20) and Board (Task 23).
  const bulkStatus = useMemo(() => bulkStatusOptions(category), [category]);

  /** Fetches a different week's class schedule/conflicts/heatmap/events for Timeline and the
   *  Focus week picker — the same endpoint and shape `WorkboardWeekView.tsx`'s Calendar page
   *  already used. `weekLoading` disables both views' paging buttons so a second click cannot
   *  race the first and land the two out of order. */
  const goToWeek = async (weekStart: string) => {
    setWeekLoading(true);
    try {
      const res = await fetch(`/api/workboard/week?start=${weekStart}`);
      if (res.ok) setWeek(await res.json());
    } finally {
      setWeekLoading(false);
    }
  };

  const openCreateDialog = () => setTypeChooserOpen(true);
  /** Quick add's hand-off (Academic tab, no courses): the palette's pre-filled create path. */
  const openCreateWithTitle = useCallback((title: string) => setDialogTarget({ mode: 'create', initialTitle: title }), []);
  const openEditDialog = (item: WorkItem) => {
    pushRecent(item);
    setDialogTarget({ mode: 'edit', item });
  };

  /** The chooser's one job: decide which of the two dialogs "New Work Item" actually meant. */
  const handleChooseType = (type: NewItemType) => {
    setTypeChooserOpen(false);
    if (type === 'task') setDialogTarget({ mode: 'create' });
    else setEventDialogTarget({ mode: 'create', itemType: type });
  };

  const openEditEventDialog = (item: WorkboardEventItem) => setEventDialogTarget({ mode: 'edit', item });

  /** Re-fetches the CURRENTLY visible week without navigating — `goToWeek` with `week`'s own
   *  `week_start` still re-runs the fetch, which is exactly "reload what an event/reminder
   *  write just changed" for `WorkboardEventDialog`'s `onSaved`. Timeline's own override editor
   *  does the equivalent by calling `onWeekChange` directly (see its own comment for why it
   *  avoids this wrapper specifically); this one is fine to use here because closing the type
   *  chooser or the event dialog was never coupled to `selectedDay` the way Timeline's internal
   *  navigation is. */
  const refreshWeek = () => goToWeek(week.week_start);

  const openDetail = (item: WorkItem) => {
    pushRecent(item);
    setDetailInstant(keyboardIntent.current);
    setDetailItem(item);
  };
  const closeDetail = () => setDetailItem(null);

  /** The open item as the *current* payload knows it, not as it was when the title was clicked.
   *
   *  The drawer's own writes (a status change, every subtask mutation) end in `refreshWork`, and
   *  the captured object is a snapshot from before them — a drawer rendering it would show the
   *  stale status it just changed. Looked up by `source`+`id`, the pair that identifies a row
   *  across the whole module (ids repeat between the four Study Pulse tables, so neither half is
   *  a key on its own). Falls back to the snapshot when the lookup misses, which is what keeps
   *  an item filtered out from under the drawer — a search typed behind it, or a completed item
   *  leaving Focus's groups — from blanking the panel the user is still reading. */
  const detailLive = detailItem === null
    ? null
    : work.items.find(i => i.source === detailItem.source && i.id === detailItem.id) ?? detailItem;
  /** Keeps the drawer mounted through its exit transition. */
  const det = usePresence(detailLive);
  /** The phone Filters sheet, reported up by WorkboardFilters: Ctrl+K must not open over it either. */
  const [filtersSheetOpen, setFiltersSheetOpen] = useState(false);
  modalOpenRef.current = dlg.value !== null || evd.value !== null || chooser.value !== null || det.value !== null
    || filtersSheetOpen;

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

  /** The only way the context tab should ever change. Two of the five filters are only meaningful
   *  inside the context that was active when they were chosen, so switching contexts clears
   *  exactly those two:
   *
   *  - `status` because its vocabulary *is* the context's. "Ready to Submit" is Academic's stage
   *    and exists in no other context's list, so carrying it into Projects would leave a filter
   *    that hides every item while naming a state that tab cannot show. My Work's normalised
   *    three have the same problem in reverse.
   *  - `projectId` because a project belongs to one context, so the chosen project is not in the
   *    next tab's list — and an out-of-list selection is a filter the popover can no longer
   *    display or unset.
   *
   *  Priority, the deadline range and overdue-only are context-independent facts about an item
   *  and deliberately survive the switch: a user narrowing to overdue high-priority work across
   *  contexts should not have to re-apply it on every tab.
   *
   *  **Both writes happen in the same event handler, deliberately, rather than in an effect that
   *  reacts to `category` afterwards.** React batches the two `setState` calls into one render, so
   *  the user sees exactly one frame: new context, filters already reset. Reacting after the fact
   *  would paint an intermediate frame at the new context with the *old* status filter still
   *  applied — and since a stage like `ready_to_submit` exists in no other context's vocabulary,
   *  `visibleItems` would momentarily go empty and the view would flash its "nothing matches"
   *  empty state before snapping back.
   *
   *  The updater returns `current` unchanged when both fields are already empty, so a switch made
   *  with no filters set costs nothing. */
  const selectCategory = (next: CategoryFilter) => {
    setCategory(next);
    // `lifeArea` joins `status`/`projectId` here for the same reason: it is Life's own
    // vocabulary (see `WorkboardFilters.tsx`'s `FilterState` doc), meaningless — and, since
    // `matchesFilters` reads it unconditionally, silently still-applied — under every other tab.
    setFilters(current =>
      current.status === '' && current.projectId === '' && current.lifeArea === ''
        ? current
        : { ...current, status: '', projectId: '', lifeArea: '' },
    );
  };

  // Stats and the workload chart deliberately read `work.stats` / `work.workload` directly
  // (whole-board numbers, computed server-side) rather than being recomputed from
  // `visibleItems` here — the direction doc and Task 12's brief both require the four stat
  // cards to describe the whole board and stay fixed as the user types or switches tabs.
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return work.items.filter(item => {
      if (hiddenKeys.has(itemKey(item))) return false;
      if (category !== 'all' && item.category !== category) return false;
      // Spec §23 step 2: the popover's filters compose into *this* memo rather than into each
      // view, so Focus, Table, Board and Timeline all narrow identically. `matchesFilters` is
      // pure and returns true for `EMPTY_FILTERS` on every item, so a user who never opens the
      // popover sees exactly the pre-Task-38 behaviour.
      if (!matchesFilters(item, filters, category, work.generated_at)) return false;
      if (!q) return true;
      return item.title.toLowerCase().includes(q)
          || (item.chip_label ?? '').toLowerCase().includes(q);
    });
  }, [work.items, work.generated_at, category, query, filters, hiddenKeys]);

  /** Widened by Task 38 to include the popover: `isFiltered` drives every view's empty-state
   *  wording, and a board emptied by a priority filter must say "nothing matches your filter",
   *  not "nothing on your plate" with a create button. `countActiveFilters` rather than a
   *  field-by-field comparison against `EMPTY_FILTERS`, so the two places that ask "is anything
   *  filtered?" — this and the trigger's badge — can never disagree. */
  const isFiltered = category !== 'all' || query.trim() !== '' || countActiveFilters(filters) > 0;
  /** The narrower half of `isFiltered`: **everything narrowing the view except the context tab
   *  itself** — today the search box or the Filters popover. The Table has three empty states
   *  rather than two, and `isFiltered` alone cannot separate "this context has no work yet"
   *  (where offering the create button is right) from "what you asked for matched nothing in this
   *  context" (where it is not), because it is true for every non-My-Work tab regardless of what
   *  else is set.
   *
   *  **Widened by Task 40 to include the popover**, which Task 38 left out. The name says "search"
   *  but the question it has always answered is "is some narrowing *other than the tab* running,
   *  so that the honest empty state is 'no matches' rather than 'nothing here yet'?" — and a
   *  popover filter that excludes every row in a context answers yes exactly as a search term
   *  does. Left un-widened, an Academic tab plus a priority filter matching nothing rendered
   *  "Nothing in Academic yet" over a context that is not empty, under a New Work Item button
   *  that would not have fixed what the user was looking at (direction doc §5e grants an action
   *  button only where the fix is available from that view).
   *
   *  Deliberately *not* merged into `isFiltered`: the two are different questions. `isFiltered`
   *  asks "is anything narrowing at all" (tab included) and gates the empty-state wording in
   *  every view; this asks "is anything *but the tab* narrowing" and exists for the Table's third
   *  state alone. */
  const isSearching = query.trim() !== '' || countActiveFilters(filters) > 0;

  /** The Overdue card's subtitle wants "oldest from <date>" (direction doc §6's example).
   *  Derived from the whole-board `work.items` (never `visibleItems`) so it never moves as
   *  the user filters — same rule as `stats`/`workload` above. */
  const oldestOverdueDue = useMemo(
    () => oldestOverdueDueOf(work.items, work.generated_at), [work.items, work.generated_at],
  );

  /** The palette searches the whole board, minus rows waiting out a delete's Undo window. */
  const paletteItems = useMemo(
    () => work.items.filter(item => !hiddenKeys.has(itemKey(item))), [work.items, hiddenKeys],
  );

  /** Whole-board course list for every quick add, so a filtered view still offers all courses. */
  const courses = useMemo(() => courseOptions(work.items), [work.items]);

  return (
    <QuickAddFullDialogContext.Provider value={openCreateWithTitle}>
    <div className="vb-bg min-h-screen pb-10" style={{ padding: '40px 5%', fontFamily: 'var(--wb-font-ui)' }}>
      <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--wb-text-muted)', font: '600 var(--wb-fs-14) var(--wb-font-ui)', textDecoration: 'none', marginBottom: '14px' }}>
        <ArrowLeft size={15} /> Dashboard
      </Link>

      {/* Spec §1 / addendum §14: the header block is the title on the left and the context
          navigation on the upper right, on one row where width allows. The 22px that used to be
          the subtitle's own bottom margin lives on this row instead, so the context group's
          `align-self: flex-end` lands near the bottom of the title block's box — the subtitle's
          line-box, not its exact text baseline — rather than 22px below it.
          `flex-wrap` on this outer row is what lets the context group drop to its own line once
          it takes `width: 100%` below 1024px; that rule, and the <768px scroll strip, are in the
          styled-jsx block at the bottom of this file (addendum §21). */}
      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: '22px' }}>
        {/* Refine spec §4: a solid title behind a small gradient mark, and the date alone
            underneath (the KPI cards already say what is due and overdue). */}
        <div className="vb-title-block">
          <h1 className="vb-title">
            <span className="vb-title__mark" aria-hidden />
            Workboard
          </h1>
          <p style={{ margin: 0, font: '500 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-text-muted)' }}>
            {formatLongDate(work.generated_at)}
          </p>
        </div>

        {/* display/flex live in the stylesheet: below 1024px this wrapper becomes
            display: contents so New item can sit on the title row and the tabs wrap under it. */}
        <div className="vb-header-actions">
          {/* New item is rendered twice so Tab follows the visual order at every width: this copy
              leads (title row, before the tabs) below 1024px, the one after the tabs trails at
              1024px and up. The other is display: none, so only one is ever focusable or announced. */}
          <button
            type="button"
            className="wb-btn-primary wb-pressable wb-focus-ring vb-new-item vb-new-item--lead"
            onClick={openCreateDialog}
            style={NEW_ITEM_STYLE}
          >
            <Plus size={16} aria-hidden /> New item
          </button>

          {/* Context navigation (direction doc §13, addendum §14) — underline-indicator pattern,
              deliberately not the view switcher's pill-fill, so the two "pick one of a few"
              controls read as different jobs (filter vs. view) at a glance. §14a makes that
              distinction carry on five axes at once now that the rows sit far apart: shape,
              active signal, resting boundary, typeface (DM Sans here, Inter there) and position.

              Deliberately `role="radiogroup"`/`role="radio"`, not the tabs pattern: this row picks
              a *filter* applied to whichever view is showing, it doesn't switch to a distinct
              content panel the way the view switcher below does. The WAI-ARIA tabs pattern assumes
              each tab owns an associated (and otherwise hidden) tabpanel; there is no second panel
              here for "Academic" to own — the same Focus/Table/Board/Timeline panel just renders
              a narrower slice of `work.items`. A single-select group of otherwise-plain buttons is
              exactly what `radiogroup`/`radio` describes, and `aria-checked` says "selected", which
              is what `aria-pressed` here was always straining to mean.

              `align-self: flex-end` is §14b's exact instruction for keeping the group shrink-to-fit
              and bottom-aligned against the title: a `width: 100%` group under a right-aligned row
              would read as a page divider rather than as this control's own baseline. For the same
              reason the row no longer carries a bottom margin of its own — inside a flex row, a
              bottom margin under `align-self: flex-end` would lift the underline off the baseline
              it is supposed to share with the title block. That `align-self`, the group's
              `flex-wrap` and each tab's `padding` are declared in the styled-jsx block below rather
              than inline, because §21's breakpoints override exactly those three (and only those
              three) properties. */}
          <div
            ref={contextNavRef}
            role="radiogroup"
            aria-label="Filter by context"
            className="vb-context-nav"
            data-at-end={contextNavAtEnd ? 'true' : undefined}
            onScroll={checkContextNavEnd}
            style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--wb-hairline)' }}
          >
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
                  onClick={() => selectCategory(key)}
                  onKeyDown={e => handleRovingKeyDown(e, idx, CATEGORY_TABS.length, categoryTabRefs, next => selectCategory(CATEGORY_TABS[next].key))}
                  className="vb-category-tab"
                  style={{
                    position: 'relative', display: 'inline-flex', alignItems: 'center',
                    minHeight: '40px', background: 'transparent', border: 'none',
                    // §14b: DM Sans (the title block's face, now that this row is part of it) and an
                    // explicit `letter-spacing: 0`, so §1's 0.04em uppercase tracking can never be
                    // inherited onto these sentence-case labels. Weight stays 700 in both states.
                    fontFamily: 'var(--wb-font-head)', letterSpacing: '0',
                    fontSize: 'var(--wb-fs-13)', fontWeight: 700, cursor: 'pointer',
                    color: active ? 'var(--wb-text)' : 'var(--wb-text-muted)',
                  }}
                >
                  {label}
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute', left: 0, right: 0, bottom: '-1px', height: '2px',
                      background: active ? 'var(--wb-pink-strong)' : 'transparent',
                    }}
                  />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="wb-btn-primary wb-pressable wb-focus-ring vb-new-item vb-new-item--trail"
            onClick={openCreateDialog}
            style={NEW_ITEM_STYLE}
          >
            <Plus size={16} aria-hidden /> New item
          </button>
        </div>
      </div>

      <WorkboardStats
        stats={work.stats}
        oldestOverdueDue={oldestOverdueDue}
        items={work.items}
        today={work.generated_at}
        weekStart={work.week_start}
      />

      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* True tabs pattern (Focus/Table/Board/Timeline each own the single tabpanel below).
            The ids stay `vb-view-tab-<key>` because the tabpanel's aria-labelledby and the
            Overdue tile's jump-to-Focus click both look them up. */}
        <div className="vb-seg-scroll">
          <WbSegmented
            options={VIEWS.map(({ key, label, Icon }) => ({ key, label, icon: <Icon size={16} aria-hidden /> }))}
            value={view}
            onChange={setView}
            ariaLabel="Workboard view"
            idPrefix="vb-view-tab"
            controls="vb-view-panel"
            hideLabelsBelow={1024}
            variant="view"
          />
        </div>

        <div className="vb-toolbar-tools" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* Below 768px the field gives way to this button (the palette is the phone's search);
              the field stays while a query is applied, so it can still be seen and cleared. */}
          <button
            type="button"
            className="vb-search-btn wb-focus-ring wb-pressable"
            aria-label="Search (opens the command palette)"
            onClick={e => openPalette(e.detail === 0)}
          >
            <Search size={18} aria-hidden />
          </button>
          <div className="vb-search-wrap" data-has-query={query !== '' ? 'true' : undefined} style={{ position: 'relative' }}>
            <Search size={15} color="var(--wb-text-subtle)" aria-hidden style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              type="search"
              className="vb-work-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search…"
              aria-label="Search work items"
              style={{
                // Right padding reserves room for the Ctrl K chip (Task 32).
                width: '100%', minHeight: '40px', boxSizing: 'border-box', borderRadius: 'var(--wb-r-lg)',
                padding: '8px 64px 8px 36px', background: 'rgba(255,255,255,.6)',
                border: '1px solid var(--wb-hairline)', font: '500 var(--wb-fs-13) var(--wb-font-ui)',
                color: 'var(--wb-text)',
              }}
            />
            <button
              type="button"
              className="wb-pal-hint wb-focus-ring"
              aria-label="Open command palette (Ctrl+K)"
              onClick={e => openPalette(e.detail === 0)}
            >
              <span className="wb-kbd">Ctrl</span><span className="wb-kbd">K</span>
            </button>
          </div>

          {/* Spec §23: a compact Filter control *beside* Search, never a permanently-expanded
              form. Placed immediately after the search box because the two do the same job —
              narrowing what the view below shows — and reading "Search … Filters" left to right
              keeps the pair together at the toolbar's trailing edge, where the panel can anchor
              to the trigger's right edge.
              `context={category}` is the same value `visibleItems` filters by, deliberately: the
              popover's status vocabulary and its project grouping both have to describe the slice
              the user is actually looking at. */}
          <WorkboardFilters
            filters={filters}
            onChange={setFilters}
            context={category}
            projects={work.projects}
            onSheetChange={setFiltersSheetOpen}
          />
        </div>
      </div>

      {/* The view switcher's single shared tabpanel — `id`/`aria-labelledby` track whichever
          tab is currently selected. Table uses the refine `.wb-glass-panel` (spec §6); Focus
          (refine spec §5), Board (spec §7, whose lanes are the panels) and Timeline (spec §8,
          whose week sheet is the panel) render bare. `flow-root` keeps the formatting context
          the removed rail's flex row gave it, so no view's margins collapse out of the panel. */}
      <div id="vb-view-panel" role="tabpanel" aria-labelledby={`vb-view-tab-${view}`} tabIndex={0} style={{ display: 'flow-root' }}>
        {/* Table sits on the refine glass panel (spec §6); its padding is 10 so the rows float
            close to the panel edge. */}
        <div
          className={view === 'table' ? 'wb-glass-panel' : undefined}
          style={view === 'table' ? { padding: '10px', boxSizing: 'border-box' } : undefined}
        >
          {view === 'list' && (
            <WorkListView
              items={visibleItems}
              todayStr={work.generated_at}
              isFiltered={isFiltered}
              onChanged={refreshWork}
              onEdit={openEditDialog}
              onOpenDetail={openDetail}
              filter={category}
              courses={courses}
              // Shares the shell's one `week` with Timeline (plan R4); `work.items` is whole-board.
              weekStart={week.week_start}
              classOccurrences={week.class_occurrences}
              onWeekChange={goToWeek}
              weekLoading={weekLoading}
              allItems={work.items}
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
              bulk={bulk}
              statusOptions={bulkStatus}
              onSelectionCount={setSelectionCount}
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
              filter={category}
              courses={courses}
              bulk={bulk}
              statusOptions={bulkStatus}
              onSelectionCount={setSelectionCount}
            />
          )}
          {view === 'timeline' && (
            <WorkTimelineView
              items={visibleItems}
              // `week.week_start`, NOT `work.week_start`: Timeline pages its own week
              // independently of the whole-board Monday the stat cards use — see `week`'s own
              // declaration above for why the two must stay decoupled.
              weekStart={week.week_start}
              today={work.generated_at}
              isFiltered={isFiltered}
              classOccurrences={week.class_occurrences}
              conflicts={week.conflicts}
              heatmap={week.heatmap}
              // Calendar's payload keeps events and reminders as two separate arrays server-
              // side (both the same `WorkboardEventItem` shape, discriminated by `item_type`);
              // Timeline shows them in one merged day-column stack, so they arrive as one prop.
              events={[...week.events, ...week.reminders]}
              onWeekChange={goToWeek}
              weekLoading={weekLoading}
              onEditEvent={openEditEventDialog}
              // The same value `visibleItems` is filtered by (required on `WorkTimelineView`),
              // also the day panel's quick-add default. That quick add creates work items, so
              // `refreshWork` (not `refreshWeek`) is what makes them appear.
              filter={category}
              courses={courses}
              onChanged={refreshWork}
              onOpenDetail={openDetail}
            />
          )}
        </div>
      </div>

      {chooser.value && (
        <NewItemTypeChooser
          open={chooser.open}
          instant={chooser.value.instant}
          onChoose={handleChooseType}
          onClose={() => setTypeChooserOpen(false)}
        />
      )}

      {dlg.value && (
        <WorkItemDialog
          // A different target remounts, so a reopen inside the exit window never inherits
          // the previous item's form state.
          key={dlg.value.target.mode === 'edit' ? itemKey(dlg.value.target.item) : 'create'}
          open={dlg.open}
          instant={dlg.value.instant}
          target={dlg.value.target}
          projects={work.projects}
          onClose={() => setDialogTarget(null)}
          onSaved={refreshWork}
          onProjectCreated={handleProjectCreated}
        />
      )}

      {evd.value && (
        <WorkboardEventDialog
          // Same reason as the item dialog's key: a reopen inside the exit window starts clean.
          key={evd.value.target.mode === 'edit' ? `edit-${evd.value.target.item.id}` : `create-${evd.value.target.itemType}`}
          open={evd.open}
          instant={evd.value.instant}
          target={evd.value.target}
          onClose={() => setEventDialogTarget(null)}
          onSaved={refreshWeek}
        />
      )}

      {/* §26's detail drawer. `onChanged` is the same `refreshWork` the dialog's `onSaved` gets:
          one refresh function, so a subtask checked in here moves the row's progress counts by
          exactly the path a dialog save moves its fields.

          Keyed by the owner pair so opening a *different* item remounts the panel rather than
          reusing it — the drawer holds that item's subtask list and draft text in state, and
          carrying either across two different work items would be a bug the user sees. */}
      {det.value && (
        <WorkItemDetail
          key={itemKey(det.value)}
          open={det.open}
          instant={detailInstant}
          item={det.value}
          todayStr={work.generated_at}
          onClose={closeDetail}
          onChanged={refreshWork}
          onDelete={item => bulk.remove([item])}
          onEdit={openEditDialog}
        />
      )}

      {pal.value && (
        <CommandPalette
          key={pal.value.id}
          open={pal.open}
          instant={pal.value.instant}
          items={paletteItems}
          today={work.generated_at}
          recentKeys={recentKeys}
          onClose={() => setPalette(null)}
          onOpenItem={openDetail}
          onGoView={setView}
          onGoContext={selectCategory}
          onCreateTask={title => setDialogTarget({ mode: 'create', initialTitle: title })}
          onCreateEvent={title => setEventDialogTarget({ mode: 'create', itemType: 'event', initialTitle: title })}
          onCreateReminder={() => setEventDialogTarget({ mode: 'create', itemType: 'reminder' })}
          onShowAllInTable={q => {
            // Clear every other narrowing first, so the Table shows the same matches the palette counted.
            selectCategory('all');
            setFilters(EMPTY_FILTERS);
            setQuery(q);
            setView('table');
          }}
        />
      )}

      <WbToaster raised={selectionCount > 0} />

      <style jsx>{`
        .vb-title {
          display: flex; align-items: center; gap: 10px; margin: 0 0 4px;
          font: 800 28px/1.15 var(--wb-font-head); letter-spacing: -0.02em; color: var(--wb-text);
        }
        .vb-title__mark {
          flex: none; width: 12px; height: 28px; border-radius: 6px;
          background: linear-gradient(180deg, var(--wb-pink-strong), var(--wb-mark-blue));
        }
        @media (max-width: 767px) {
          .vb-title { font-size: 22px; }
          .vb-title__mark { width: 10px; height: 22px; border-radius: 5px; }
        }
        .vb-category-tab:focus-visible,
        .vb-work-search:focus-visible {
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 2px;
          border-radius: inherit;
        }
        #vb-view-panel:focus-visible {
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 2px;
          border-radius: var(--wb-r-panel);
        }
        .vb-seg-scroll { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
        .vb-seg-scroll::-webkit-scrollbar { display: none; }
        .vb-toolbar-tools { flex-wrap: wrap; }
        .vb-search-wrap { min-width: 220px; }
        .vb-search-btn {
          display: none; place-items: center; width: 40px; height: 40px; flex-shrink: 0; padding: 0;
          border-radius: var(--wb-r-lg); border: 1px solid var(--wb-hairline);
          background: var(--wb-hover); color: var(--wb-text-muted); cursor: pointer;
        }
        @media (max-width: 767px) {
          .vb-seg-scroll { width: 100%; }
          /* Phone: the search icon, an applied query (if any) and Filters share one row. */
          .vb-toolbar-tools { width: 100%; flex-wrap: nowrap; }
          .vb-search-btn { display: grid; }
          .vb-search-wrap { display: none; flex: 1; min-width: 0; }
          .vb-search-wrap[data-has-query='true'] { display: block; }
          .vb-work-search { padding-right: 12px !important; }
        }
        /* Header actions: tabs then New item, right of the title, at >= 1024px. */
        .vb-header-actions {
          display: flex;
          gap: 12px;
          align-items: flex-end;
          flex-wrap: wrap;
        }
        .vb-new-item { display: inline-flex; }
        .vb-new-item--lead { display: none; }
        /* Addendum §21's context-navigation row. Every property below is in the stylesheet
           rather than inline for one reason: a media query has to override it, and an inline
           declaration beats a class selector in every media state. align-self, flex-wrap
           and the tab padding therefore live here as base rules (identical to the values
           they had inline) so the two breakpoints beneath them can actually take effect —
           the discipline §21 spells out, and the bug that shipped Board's mobile snap-scroll
           dead in v2. Properties that never change across widths stay inline, untouched. */
        .vb-context-nav {
          align-self: flex-end;
          flex-wrap: wrap;
        }
        .vb-category-tab {
          padding: 10px 16px;
        }
        /* 768–1023px: the row leaves the title's baseline and takes the full width on its own
           line, at §21's 10px 12px floor. It never shrinks below that, never drops labels for
           icons, and never collapses to a select element — unlike the view switcher above,
           whose four icons are conventional where "Organization" has no guessable glyph (§21). */
        /* Below 1024px the wrapper dissolves: title and New item share the first line
           (space-between pushes the button right), and the tabs take the next line at full width. */
        @media (max-width: 1023px) {
          .vb-header-actions {
            display: contents;
          }
          .vb-title-block {
            flex: 1 1 0;
            min-width: 0;
          }
          .vb-new-item {
            order: 1;
            align-self: center;
            flex-shrink: 0;
          }
          .vb-new-item--lead { display: inline-flex; }
          .vb-new-item--trail { display: none; }
          .vb-context-nav {
            order: 2;
            align-self: stretch;
            width: 100%;
          }
          .vb-category-tab {
            padding: 10px 12px;
          }
        }
        /* Below 768px: a horizontally scrolling snap strip. flex-shrink: 0 on the items is
           load-bearing, not decorative — inside a nowrap overflow-x row a flex item will
           still shrink to fit the viewport, squeezing the labels instead of producing the
           scrollable strip this breakpoint exists to create. */
        @media (max-width: 767px) {
          .vb-context-nav {
            flex-wrap: nowrap;
            overflow-x: auto;
            /* A specified overflow-y: visible computes to auto the moment overflow-x is auto
               (CSS Overflow 3), so this row becomes a scroll container on both axes and clips
               to its own padding box — including the active indicator's deliberate 1px
               bottom overhang (it sits at bottom: -1px to straddle the group's border). The
               1px bottom padding buys that pixel of box back without shifting the tabs. */
            padding-bottom: 1px;
            scroll-snap-type: x proximity;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            /* Right-edge fade as a scroll cue (refine spec §4), dropped at the end of the strip. */
            -webkit-mask-image: linear-gradient(90deg, black 80%, transparent);
            mask-image: linear-gradient(90deg, black 80%, transparent);
          }
          .vb-context-nav[data-at-end='true'] {
            -webkit-mask-image: none;
            mask-image: none;
          }
          .vb-context-nav::-webkit-scrollbar {
            display: none;
          }
          .vb-category-tab {
            scroll-snap-align: start;
            flex-shrink: 0;
          }
        }
      `}</style>
    </div>
    </QuickAddFullDialogContext.Provider>
  );
}
