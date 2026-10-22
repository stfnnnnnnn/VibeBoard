'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchX } from 'lucide-react';
import type { WorkItem } from '@/lib/workboard/workItems';
import type { ClassOccurrence } from '@/lib/workboard/aggregate';
import { isWaitingStage, type WorkContext } from '@/lib/workboard/workContexts';
import { setWorkStage } from '../WorkItemRow';
import FocusRow from './FocusRow';
import FocusWeekPicker from './FocusWeekPicker';
import { UpNextHero, UpNextCard } from './UpNext';
import { useDeadlineEditor } from '../table/DeadlineCell';
import WbQuickAdd from '../ui/WbQuickAdd';
import { toastError, toastUndo } from '../ui/WbToaster';
import { addDays } from '@/lib/workboard/dates';
import { itemKey } from '@/lib/workboard/ui/itemKey';
import type { CourseOption } from '@/lib/workboard/ui/quickAdd';
import {
  foldLabel, rankUpNext, showAllGroups, SHOW_ALL_LABELS, SHOW_ALL_ORDER, UP_NEXT_LIMIT, type ShowAllKey,
} from '@/lib/workboard/ui/upNext';

/** The Up next hero's anchor: the Overdue KPI card's "Review →" scrolls here and flashes it. */
export const UP_NEXT_ID = 'vb-up-next';
/** Window event asking Focus to show Up next: on phone, an open picker day unmounts it. */
export const SHOW_UP_NEXT_EVENT = 'wb:show-up-next';

/** Spec §5.3: the phone shows the hero plus 2 compact cards. */
const PHONE_UP_NEXT_LIMIT = 3;
const SHOW_ALL_STORAGE_KEY = 'wb-focus-showall';

/** A Show all group's quick add date, as days from today; `null` adds without a deadline.
 *  More overdue and Waiting have no "+ Add". */
const GROUP_ADD: Partial<Record<ShowAllKey, { offset: number | null; label: string }>> = {
  this_week:   { offset: 2,    label: 'Add to This week' },
  next_week:   { offset: 8,    label: 'Add to Next week' },
  later:       { offset: 15,   label: 'Add for later' },
  no_deadline: { offset: null, label: 'Add without a deadline' },
};

type AddTarget = ShowAllKey | 'today';

/** Same shape as Timeline's: SSR assumes the default, the effect corrects it after mount. */
function useMedia(query: string, ssrDefault: boolean): boolean {
  const [matches, setMatches] = useState(ssrDefault);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

function readShowAll(): boolean | null {
  try {
    const v = window.localStorage.getItem(SHOW_ALL_STORAGE_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

function writeShowAll(open: boolean) {
  try {
    window.localStorage.setItem(SHOW_ALL_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // Storage blocked (private mode, quota): the toggle still works for this visit.
  }
}

export interface WorkListViewProps {
  /** Already filtered by category and search — see `WorkboardShell`'s `visibleItems`. */
  items:      WorkItem[];
  /** "YYYY-MM-DD" — `work.generated_at`, so every row agrees on "today" regardless of filtering. */
  todayStr:   string;
  /** True when the shell's category tab or search query is currently narrowing `items` —
   *  distinguishes "genuinely nothing on the board" from "nothing matches this filter", which
   *  need different empty-state copy. */
  isFiltered?: boolean;
  onChanged:  () => void | Promise<void>;
  /** Opens the create/edit dialog in edit mode for a given item (each row's overflow menu). */
  onEdit:     (item: WorkItem) => void;
  /** Opens the detail drawer for a given item — each row's title is the trigger. */
  onOpenDetail: (item: WorkItem) => void;
  /** The shell's context tab; quick add uses it to pick the new item's context. */
  filter:     WorkContext | 'all';
  /** Whole-board course list for quick add's course select (`courseOptions(work.items)`). */
  courses:    CourseOption[];
  /** The shell's shared week (plan R4): `week.week_start`, paged by `onWeekChange` (`goToWeek`). */
  weekStart:        string;
  classOccurrences: ClassOccurrence[];
  onWeekChange:     (weekStart: string) => void;
  weekLoading:      boolean;
  /** Whole-board items (`work.items`), unfiltered, for the week picker's load bars. */
  allItems:         WorkItem[];
}

export default function WorkListView({
  items, todayStr, isFiltered, onChanged, onEdit, onOpenDetail, filter, courses,
  weekStart, classOccurrences, onWeekChange, weekLoading, allItems: boardItems,
}: WorkListViewProps) {
  const isPhone = useMedia('(max-width: 767px)', false);
  const isDesktop = useMedia('(min-width: 1024px)', true);

  const [completing, setCompleting] = useState<Set<string>>(() => new Set());
  // Mirror of `completing` read synchronously, so a fast double click cannot slip past stale state.
  const completingRef = useRef<Set<string>>(new Set());
  const [addingTo, setAddingTo] = useState<AddTarget | null>(null);
  const editor = useDeadlineEditor(onChanged);

  const ranked = useMemo(() => rankUpNext(items, todayStr), [items, todayStr]);
  const upNext = ranked.slice(0, isPhone ? PHONE_UP_NEXT_LIMIT : UP_NEXT_LIMIT);
  const heroKey = upNext.length > 0 ? itemKey(upNext[0]) : null;
  const upNextSig = upNext.map(itemKey).join('|');

  // Show all: every open item not in Up next, in exactly one group (plan R3).
  const groups = useMemo(
    () => showAllGroups(items, todayStr, new Set(upNextSig ? upNextSig.split('|') : [])),
    [items, todayStr, upNextSig],
  );
  const label = foldLabel(groups);
  const showAllCount = SHOW_ALL_ORDER.reduce((n, k) => n + groups[k].length, 0);
  const totalOpen = upNext.length + showAllCount;

  // Stored preference, read after mount, default collapsed. With Up next empty, Show all is the
  // only work on screen, so it opens regardless and a toggle there stays out of storage.
  const [showAllPref, setShowAllPref] = useState<boolean | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(true);
  useEffect(() => { setShowAllPref(readShowAll()); }, []);
  const upNextEmpty = upNext.length === 0;
  const showAllOpen = upNextEmpty ? emptyOpen : showAllPref ?? false;
  const toggleShowAll = () => {
    const next = !showAllOpen;
    if (upNextEmpty) {
      setEmptyOpen(next);
    } else {
      setShowAllPref(next);
      writeShowAll(next);
    }
    if (!next) setAddingTo(cur => (cur === 'today' ? cur : null));
  };

  // The picker's selected day: today when it is in the shown week, else the week's Monday, and
  // reset the same way whenever the week changes.
  const defaultDay = (ws: string) => (todayStr >= ws && todayStr <= addDays(ws, 6) ? todayStr : ws);
  const [sel, setSel] = useState(() => ({ ws: weekStart, day: defaultDay(weekStart) }));
  const selected = sel.ws === weekStart ? sel.day : defaultDay(weekStart);
  // Phone: a tapped day swaps the Up next area for that day's list; cleared on week change too.
  const [phoneSel, setPhoneSel] = useState<{ ws: string; day: string } | null>(null);
  const phoneDay = isPhone && phoneSel && phoneSel.ws === weekStart ? phoneSel.day : null;
  // The Overdue KPI's "Review →" closes the open day so `#vb-up-next` mounts; the KPI then
  // scrolls to and flashes it after the next paint.
  useEffect(() => {
    const show = () => setPhoneSel(null);
    window.addEventListener(SHOW_UP_NEXT_EVENT, show);
    return () => window.removeEventListener(SHOW_UP_NEXT_EVENT, show);
  }, []);

  // The promotion crossfade follows only the input that caused it: the key of a hero completed
  // by pointer. The hero promoted after it animates; any other hero change (search, Undo,
  // Reschedule, keyboard completion, first paint) mounts instantly.
  const [animateAfter, setAnimateAfter] = useState<string | null>(null);
  const heroInstant = animateAfter === null || upNext.some(i => itemKey(i) === animateAfter);
  // Consumed once the hero changes; the new hero froze its `instant` on mount.
  useEffect(() => { setAnimateAfter(null); }, [heroKey]);

  // Keyboard focus that was inside Up next (or its Reschedule popover) and then lost to the
  // body when a completion or reschedule remounted its node lands on the hero's checkbox, else
  // on the Up next heading, else on the empty state's heading.
  const upNextRef = useRef<HTMLElement>(null);
  const fallbackHeadingRef = useRef<HTMLHeadingElement>(null);
  const foldRef = useRef<HTMLButtonElement>(null);
  const focusWasInUpNext = useRef(false);
  useEffect(() => {
    if (!focusWasInUpNext.current) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const target = upNextRef.current?.querySelector<HTMLElement>('.vb-upnext-hero .wb-check')
      ?? fallbackHeadingRef.current;
    target?.focus();
    focusWasInUpNext.current = false;
  }, [upNextSig]);
  // A pointer press elsewhere is a deliberate move away, even onto something unfocusable.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Element && !upNextRef.current?.contains(t) && !t.closest('.wb-popover')) {
        focusWasInUpNext.current = false;
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const without = (key: string) => (s: Set<string>) => { const n = new Set(s); n.delete(key); return n; };
  const short = (t: string) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);

  // Spec §14: one click completes; the row collapses while the write is in flight and stays
  // gone once the refreshed payload drops it, with Undo restoring the previous stage.
  const complete = async (item: WorkItem) => {
    const key = itemKey(item);
    if (completingRef.current.has(key)) return false;
    completingRef.current.add(key);
    const prevStage = item.work_stage;
    const prevReason = item.blocked_reason;
    moveFocusOffCollapsingRow();
    setCompleting(s => new Set(s).add(key));
    const clear = () => { completingRef.current.delete(key); setCompleting(without(key)); };
    const res = await setWorkStage(item, 'done').catch(() => null);
    if (!res || !res.ok) {
      clear();
      toastError(`Couldn't complete "${short(item.title)}"`, () => { void complete(item); });
      return false;
    }
    toastUndo(`Completed "${short(item.title)}"`, async () => {
      // Accepted limitation: restoring a Waiting item re-stamps blocked_since server-side,
      // so its "waiting N days" count restarts.
      const keepsReason = isWaitingStage(prevStage);
      const undo = await setWorkStage(item, prevStage, keepsReason ? prevReason : undefined).catch(() => null);
      if (!undo || !undo.ok) toastError("Couldn't undo");
      await onChanged();
    });
    try {
      await onChanged();
    } finally {
      clear();
    }
    return true;
  };

  /** The row is about to collapse and go inert; if focus is inside it, hand focus to the next
   *  live row's checkbox, or else to the Show all fold button, so keyboard users are not
   *  dropped to the document body. */
  const moveFocusOffCollapsingRow = () => {
    const active = document.activeElement;
    const row = active instanceof HTMLElement ? active.closest('.vb-showall .wb-collapse') : null;
    if (!row) return;
    let next = row.nextElementSibling;
    while (next && next.getAttribute('data-collapsed') === 'true') next = next.nextElementSibling;
    const target = next?.querySelector<HTMLElement>('.wb-check') ?? foldRef.current;
    target?.focus();
  };

  const completeFromUpNext = async (item: WorkItem, viaKeyboard: boolean) => {
    const key = itemKey(item);
    const wasHero = key === heroKey;
    if (wasHero && !viaKeyboard) setAnimateAfter(key);
    const ok = await complete(item);
    if (!ok && wasHero) setAnimateAfter(cur => (cur === key ? null : cur));
  };

  /** The collapse + `inert` wrapper shared by Up next cards and Show all rows. */
  const collapsible = (item: WorkItem, child: React.ReactNode) => {
    const isCollapsing = completing.has(itemKey(item));
    return (
      <div key={itemKey(item)} className="wb-collapse" data-collapsed={isCollapsing ? 'true' : undefined} inert={isCollapsing}>
        <div>{child}</div>
      </div>
    );
  };

  const quickAdd = (key: AddTarget, qaLabel: string, dueAt: string | null, groupItems: WorkItem[]) => (
    <WbQuickAdd
      open={addingTo === key}
      onClose={() => setAddingTo(cur => (cur === key ? null : cur))}
      label={qaLabel}
      defaults={{
        dueAt,
        preferredCourseId: groupItems.find(i => i.user_subject_id != null)?.user_subject_id ?? null,
      }}
      filter={filter}
      courses={courses}
      onCreated={onChanged}
    />
  );

  const pickerProps = {
    items, allItems: boardItems, classOccurrences, weekStart, todayStr, onWeekChange, weekLoading,
    onComplete: (item: WorkItem) => { void complete(item); },
    onOpenDetail, filter, courses, onChanged,
  };

  // ---- Up next area (or the board's empty states) ----
  let upNextArea: React.ReactNode;
  if (phoneDay) {
    upNextArea = (
      <FocusWeekPicker
        {...pickerProps}
        variant="day"
        selected={phoneDay}
        onSelect={() => {}}
        onBack={() => { setPhoneSel(null); requestAnimationFrame(() => fallbackHeadingRef.current?.focus()); }}
      />
    );
  } else if (totalOpen === 0 && isFiltered) {
    upNextArea = (
      <div className="vb-focus-empty">
        <SearchX size={40} aria-hidden style={{ color: 'var(--wb-text-faint)', marginBottom: '12px' }} />
        <h2 ref={fallbackHeadingRef} tabIndex={-1} className="vb-focus-empty__title">No matching work items</h2>
        <p className="vb-focus-empty__body">Try a different category, search term, or filter.</p>
      </div>
    );
  } else if (totalOpen === 0) {
    // Once the first item lands, Up next replaces this block and shows it.
    upNextArea = (
      <div className="vb-focus-empty">
        <h2 ref={fallbackHeadingRef} tabIndex={-1} className="vb-focus-empty__title">Nothing urgent. Nice.</h2>
        {addingTo !== 'today' && (
          // --wb-blue-ink is ~4.35:1 on the bare background; the scoped rule switches it to text + underline.
          <button type="button" className="wb-add-trigger wb-focus-ring vb-focus-empty__add" onClick={() => setAddingTo('today')}>
            Add something for today →
          </button>
        )}
        <div className="vb-focus-empty__qa">{quickAdd('today', 'Add to Today', todayStr, [])}</div>
      </div>
    );
  } else {
    upNextArea = (
      <section
        ref={upNextRef}
        id={UP_NEXT_ID}
        aria-labelledby="vb-upnext-heading"
        className="vb-upnext"
        onFocus={() => { focusWasInUpNext.current = true; }}
        onBlur={e => {
          // Focus moving elsewhere on purpose clears the flag; a removed node (no relatedTarget)
          // or the portalled Reschedule popover keeps it, so the fallback can still run.
          const to = e.relatedTarget;
          if (to instanceof Element && !e.currentTarget.contains(to) && !to.closest('.wb-popover')) {
            focusWasInUpNext.current = false;
          }
        }}
      >
        <h2 id="vb-upnext-heading" ref={fallbackHeadingRef} tabIndex={-1} className="vb-upnext__brow">Up next</h2>
        {upNext.length === 0 ? (
          <p className="wb-glass-item vb-upnext__none">Nothing due soon</p>
        ) : (<>
          {collapsible(upNext[0], (
            <UpNextHero
              item={upNext[0]}
              todayStr={todayStr}
              onComplete={completeFromUpNext}
              onOpenDetail={onOpenDetail}
              editor={editor}
              instant={heroInstant}
            />
          ))}
          {upNext.slice(1).map(item => collapsible(item, (
            <UpNextCard item={item} todayStr={todayStr} onComplete={completeFromUpNext} onOpenDetail={onOpenDetail} />
          )))}
          {label === '' && <p className="vb-upnext__clear">✓ Nothing else due this week</p>}
        </>)}
      </section>
    );
  }

  // ---- Show all ----
  const showAll = label !== '' && (
    <div className="vb-showall">
      <button
        ref={foldRef}
        type="button"
        className="vb-fold wb-focus-ring"
        aria-expanded={showAllOpen}
        aria-controls="vb-showall-panel"
        onClick={toggleShowAll}
      >
        <span className="vb-fold__label">{label}</span>
        <span className="vb-fold__act">{showAllOpen ? 'Hide ▴' : 'Show all ▾'}</span>
      </button>
      <div
        id="vb-showall-panel"
        className="wb-collapse"
        data-collapsed={showAllOpen ? undefined : 'true'}
        inert={!showAllOpen}
      >
        <div>
          <div className="wb-glass-panel vb-showall__panel">
            <p className="vb-showall__head">All work · {showAllCount}</p>
            {SHOW_ALL_ORDER.filter(k => groups[k].length > 0).map(k => {
              const add = GROUP_ADD[k];
              const groupItems = groups[k];
              return (
                <div key={k} className="vb-grp">
                  <div className="vb-grp__head">
                    <h3 className="vb-grp__label">{SHOW_ALL_LABELS[k]} · {groupItems.length}</h3>
                    {add && addingTo !== k && (
                      <button type="button" className="wb-add-trigger wb-focus-ring" aria-label={add.label}
                        onClick={() => setAddingTo(k)}>
                        + Add
                      </button>
                    )}
                  </div>
                  {groupItems.map(item => collapsible(item, (
                    <FocusRow
                      item={item}
                      todayStr={todayStr}
                      onComplete={complete}
                      onOpenDetail={onOpenDetail}
                      onEdit={onEdit}
                      variant={k === 'waiting' ? 'waiting' : undefined}
                    />
                  )))}
                  {/* Always mounted so in-flight drafts survive the group closing. */}
                  {add && quickAdd(k, add.label, add.offset === null ? null : addDays(todayStr, add.offset), groupItems)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  const picker = (
    <FocusWeekPicker {...pickerProps} selected={selected} onSelect={d => setSel({ ws: weekStart, day: d })} />
  );

  let body: React.ReactNode;
  if (isPhone) {
    body = (
      <div className="vb-focus-col">
        <FocusWeekPicker
          {...pickerProps}
          variant="strip"
          selected={phoneDay ?? ''}
          onSelect={d => setPhoneSel(phoneDay === d ? null : { ws: weekStart, day: d })}
        />
        {upNextArea}
        {showAll}
      </div>
    );
  } else if (isDesktop) {
    body = (
      <div className="vb-focus-grid">
        <div className="vb-focus-col">{upNextArea}{showAll}</div>
        {picker}
      </div>
    );
  } else {
    body = <div className="vb-focus-col">{upNextArea}{picker}{showAll}</div>;
  }

  return (
    // The markup above is built in variables, outside this tree, so it carries no styled-jsx
    // scope class: every rule is anchored on the scoped root and reaches in with :global().
    <div className="vb-focus">
      {body}
      <style jsx>{`
        .vb-focus :global(.vb-focus-grid) { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
        .vb-focus :global(.vb-focus-col) { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
        .vb-focus :global(.vb-focus-col > *) { min-width: 0; }
        .vb-focus :global(.vb-focus-empty) { text-align: center; padding: 48px 20px; }
        .vb-focus :global(.vb-focus-empty__title) { font: 800 var(--wb-fs-16) var(--wb-font-head); color: var(--wb-text); margin: 0 0 8px; }
        .vb-focus :global(.vb-focus-empty__title:focus) { outline: none; }
        .vb-focus :global(.vb-focus-empty__body) { font: 500 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text); margin: 0; }
        .vb-focus :global(.vb-focus-empty__add) { color: var(--wb-text); text-decoration: underline; text-underline-offset: 2px; }
        .vb-focus :global(.vb-focus-empty__qa) { max-width: 520px; margin: 8px auto 0; text-align: left; }
        .vb-focus :global(.vb-upnext) { scroll-margin-top: 16px; }
        .vb-focus :global(.vb-upnext__brow) {
          margin: 0 0 8px; font: 800 var(--wb-fs-11) var(--wb-font-ui); letter-spacing: .06em;
          text-transform: uppercase; color: var(--wb-text);
        }
        .vb-focus :global(.vb-upnext__brow:focus) { outline: none; }
        .vb-focus :global(.vb-upnext__brow:focus-visible) { outline: 2px solid var(--wb-blue-strong); outline-offset: 2px; border-radius: 4px; }
        .vb-focus :global(.vb-upnext__none) { margin: 0; padding: 12px 14px; font: 600 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text); }
        .vb-focus :global(.vb-upnext__clear) {
          display: flex; align-items: center; gap: 10px; margin: 0; padding: 14px; border-radius: 12px;
          background: rgba(47, 157, 106, .08); color: var(--wb-success); font: 600 var(--wb-fs-13) var(--wb-font-ui);
        }
        .vb-focus :global(.vb-fold) {
          display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 36px;
          padding: 6px 4px; border: 0; border-radius: var(--wb-r-sm); background: transparent; cursor: pointer; text-align: left;
          font: 600 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text);
        }
        .vb-focus :global(.vb-fold__label) { min-width: 0; }
        .vb-focus :global(.vb-fold__act) { flex: none; white-space: nowrap; }
        @media (hover: hover) and (pointer: fine) { .vb-focus :global(.vb-fold:hover) { background: var(--wb-hover); } }
        .vb-focus :global(.vb-showall__panel) { padding: 8px 10px; margin-top: 6px; }
        .vb-focus :global(.vb-showall__head) { margin: 0; padding: 4px; font: 600 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text-muted); }
        .vb-focus :global(.vb-grp__head) { display: flex; align-items: center; gap: 6px; margin: 12px 4px 2px; }
        .vb-focus :global(.vb-grp__label) {
          flex: 1; min-width: 0; margin: 0; font: 800 var(--wb-fs-11) var(--wb-font-ui); letter-spacing: .06em;
          text-transform: uppercase; color: var(--wb-text-muted);
        }
        @media (max-width: 767px) {
          .vb-focus :global(.vb-fold) { min-height: 44px; }
        }
      `}</style>
    </div>
  );
}
