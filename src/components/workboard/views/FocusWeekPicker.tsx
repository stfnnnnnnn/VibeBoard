'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
// Type-only: `workItems.ts` and `aggregate.ts` reach `pool` at module scope.
import type { WorkItem } from '@/lib/workboard/workItems';
import type { ClassOccurrence } from '@/lib/workboard/aggregate';
import { isRevisionStage, isWaitingStage, waitingLabel, type WorkContext } from '@/lib/workboard/workContexts';
import type { CourseOption } from '@/lib/workboard/ui/quickAdd';
import { addDays, dueDateOf, mondayOf } from '@/lib/workboard/dates';
import { dueBarHeight, weekPickerDays } from '@/lib/workboard/ui/weekPicker';
import { buildDayEntries, entryKey, isSkippedClass, toMinutes, type DayEntry } from '@/lib/workboard/ui/dayEntries';
import { formatClock } from '@/lib/workboard/ui/nowMinutes';
import WbCheckbox from '../ui/WbCheckbox';
import WbQuickAdd from '../ui/WbQuickAdd';

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
const monthDay = (d: string) => fmt(d, { month: 'short', day: 'numeric' });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface FocusWeekPickerProps {
  /** Filtered items (search and context apply): the selected-day list. */
  items: WorkItem[];
  /** Whole-board items: the tile bars, so they don't change with search. */
  allItems: WorkItem[];
  classOccurrences: ClassOccurrence[];
  weekStart: string;
  todayStr: string;
  onWeekChange: (weekStart: string) => void;
  weekLoading: boolean;
  /** The selected date; '' selects nothing (the phone strip with no day open). */
  selected: string;
  onSelect: (date: string) => void;
  onComplete: (item: WorkItem) => void;
  onOpenDetail: (item: WorkItem) => void;
  filter: WorkContext | 'all';
  courses: CourseOption[];
  onChanged: () => void | Promise<void>;
  /** `panel`: header, tiles and day list (desktop, tablet). `strip`: header and bar-less tiles,
   *  no panel chrome (phone). `day`: the day list alone, in a panel, with a Back button (phone). */
  variant?: 'panel' | 'strip' | 'day';
  onBack?: () => void;
}

export default function FocusWeekPicker(props: FocusWeekPickerProps) {
  const { variant = 'panel', onSelect } = props;
  // Pointer selection crossfades the day list; first paint and keyboard selection don't.
  const [instant, setInstant] = useState(true);
  const select = (date: string, viaKeyboard: boolean) => { setInstant(viaKeyboard); onSelect(date); };

  if (variant === 'day') {
    return (
      <div className="wb-glass-panel vb-wp">
        {props.onBack && (
          <button type="button" className="wb-add-trigger wb-focus-ring vb-wp__back" onClick={props.onBack}>
            ← Back to up next
          </button>
        )}
        <DayList {...props} instant />
        <style jsx>{`
          .vb-wp { padding: 14px; font-family: var(--wb-font-ui); }
          .vb-wp__back { margin: -4px 0 6px -6px; }
        `}</style>
      </div>
    );
  }
  const strip = variant === 'strip';
  return (
    <div className={strip ? 'vb-wp vb-wp--strip' : 'wb-glass-panel vb-wp'}>
      <WeekHeader {...props} strip={strip} />
      {/* Keyed by week: the roving tab stop resets with the week. */}
      <Tiles key={props.weekStart} {...props} strip={strip} select={select} />
      {!strip && <DayList {...props} instant={instant} />}
      <style jsx>{`
        .vb-wp { padding: 14px; font-family: var(--wb-font-ui); }
        .vb-wp--strip { padding: 0; }
      `}</style>
    </div>
  );
}

function WeekHeader({ weekStart, todayStr, onWeekChange, weekLoading, strip }: FocusWeekPickerProps & { strip: boolean }) {
  const inWeek = todayStr >= weekStart && todayStr <= addDays(weekStart, 6);
  return (
    // The strip has no panel behind it: muted text would miss 4.5:1 on the bare background.
    <div className="vb-wp-head" data-bare={strip ? 'true' : undefined}>
      <h2 className="vb-wp-head__label">Week of {monthDay(weekStart)}</h2>
      {!inWeek && (
        <button type="button" className="wb-gpill wb-focus-ring vb-wp-head__today" disabled={weekLoading}
          onClick={() => onWeekChange(mondayOf(todayStr))}>
          Today
        </button>
      )}
      <button type="button" className="vb-wp-head__nav wb-focus-ring" aria-label="Previous week" disabled={weekLoading}
        onClick={() => onWeekChange(addDays(weekStart, -7))}>
        <ChevronLeft size={16} aria-hidden />
      </button>
      <button type="button" className="vb-wp-head__nav wb-focus-ring" aria-label="Next week" disabled={weekLoading}
        onClick={() => onWeekChange(addDays(weekStart, 7))}>
        <ChevronRight size={16} aria-hidden />
      </button>
      <style jsx>{`
        .vb-wp-head { display: flex; align-items: center; gap: 4px; margin: 0 0 10px; }
        .vb-wp-head__label {
          flex: 1; min-width: 0; margin: 0; font: 800 var(--wb-fs-11) var(--wb-font-ui); letter-spacing: .06em;
          text-transform: uppercase; color: var(--wb-text-muted);
        }
        .vb-wp-head[data-bare='true'] .vb-wp-head__label { color: var(--wb-text); }
        .vb-wp-head__today { cursor: pointer; padding: 3px 10px; margin-right: 4px; }
        .vb-wp-head__nav {
          display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; cursor: pointer;
          border: 0; border-radius: var(--wb-r-sm); background: transparent; color: var(--wb-text);
        }
        .vb-wp-head__nav:disabled, .vb-wp-head__today:disabled { opacity: .5; cursor: default; }
        @media (hover: hover) and (pointer: fine) {
          .vb-wp-head__nav:hover:not(:disabled) { background: var(--wb-hover); }
        }
        @media (max-width: 767px) {
          .vb-wp-head { margin-bottom: 6px; }
          .vb-wp-head__nav { width: 40px; height: 40px; }
          .vb-wp-head__today { min-height: 32px; }
        }
      `}</style>
    </div>
  );
}

function Tiles({
  allItems, classOccurrences, weekStart, todayStr, weekLoading, selected, strip, select,
}: FocusWeekPickerProps & { strip: boolean; select: (date: string, viaKeyboard: boolean) => void }) {
  const days = weekPickerDays(allItems, classOccurrences, weekStart, todayStr);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selIdx = days.findIndex(d => d.date === selected);
  const todayIdx = days.findIndex(d => d.isToday);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const tabStop = focusIdx ?? (selIdx !== -1 ? selIdx : todayIdx !== -1 ? todayIdx : 0);

  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = Math.min(6, idx + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, idx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 6;
    if (next === null) return;
    e.preventDefault();
    setFocusIdx(next);
    btnRefs.current[next]?.focus();
    // The panel follows focus, like WbSegmented; on the phone strip a tap swaps the whole Up
    // next area, so arrows only move focus there.
    if (!strip) select(days[next].date, true);
  };

  return (
    <div className="vb-wp-tiles" role="group" aria-label="Days of the week" aria-busy={weekLoading || undefined}>
      {days.map((d, idx) => {
        const bar = dueBarHeight(d, days);
        const label = `${fmt(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}${d.isToday ? ', today' : ''}, `
          + `${d.dueCount} due, ${plural(d.classCount, 'class', 'classes')}`;
        return (
          <button
            key={d.date}
            ref={el => { btnRefs.current[idx] = el; }}
            type="button"
            className="vb-wp-tile wb-focus-ring"
            data-past={d.isPast ? 'true' : undefined}
            aria-pressed={selected === d.date}
            aria-label={label}
            tabIndex={idx === tabStop ? 0 : -1}
            onClick={e => { setFocusIdx(idx); select(d.date, e.detail === 0); }}
            onKeyDown={e => onKeyDown(e, idx)}
          >
            <span className="vb-wp-tile__d" data-today={d.isToday ? 'true' : undefined} aria-hidden>
              {fmt(d.date, { weekday: 'narrow' })}
            </span>
            <span className="vb-wp-tile__n" aria-hidden>{Number(d.date.slice(8))}</span>
            {!strip && (
              <span className="vb-wp-tile__bars" aria-hidden>
                {bar > 0 && <i className="vb-wp-bar vb-wp-bar--due" style={{ height: bar }} />}
                {Array.from({ length: Math.min(3, d.classCount) }, (_, i) => (
                  <i key={i} className="vb-wp-bar vb-wp-bar--class" />
                ))}
              </span>
            )}
          </button>
        );
      })}
      <style jsx>{`
        .vb-wp-tiles { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: ${strip ? 4 : 6}px; }
        .vb-wp-tile {
          display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; min-height: 44px;
          padding: ${strip ? '6px 2px' : '8px 4px'}; border: 0; border-radius: 11px; cursor: pointer;
          background: rgba(255, 255, 255, .5); font-family: var(--wb-font-ui); color: var(--wb-text);
        }
        /* Past days: only the bars fade; the text stays opaque and muted so it keeps 4.5:1. */
        .vb-wp-tile[data-past='true'] .vb-wp-tile__bars { opacity: .55; }
        .vb-wp-tile[data-past='true'] .vb-wp-tile__n { color: var(--wb-text-muted); }
        .vb-wp-tile[aria-pressed='true'] { background: var(--wb-surface); box-shadow: 0 0 0 2px rgba(217, 79, 134, .4); }
        .vb-wp-tile__d { font: 800 var(--wb-fs-11) var(--wb-font-ui); letter-spacing: .05em; color: var(--wb-text-muted); }
        .vb-wp-tile__d[data-today='true'] { color: var(--wb-pink-ink); }
        .vb-wp-tile__n { font: 700 15px/1.2 var(--wb-font-ui); }
        .vb-wp-tile__bars { display: flex; gap: 2px; justify-content: center; align-items: flex-end; height: 18px; margin-top: 5px; }
        .vb-wp-bar { display: block; width: 6px; border-radius: 2px; }
        .vb-wp-bar--due { background: var(--wb-pink-strong); opacity: .8; }
        .vb-wp-bar--class { height: 6px; background: var(--wb-blue); opacity: .55; }
        @media (hover: hover) and (pointer: fine) {
          .vb-wp-tile:hover:not([aria-pressed='true']) { background: rgba(255, 255, 255, .78); }
        }
      `}</style>
    </div>
  );
}

function DayList({
  items, classOccurrences, todayStr, selected, onComplete, onOpenDetail, filter, courses, onChanged, instant,
}: FocusWeekPickerProps & { instant: boolean }) {
  const [adding, setAdding] = useState(false);
  // A half-typed title must not silently move to a different day.
  useEffect(() => { setAdding(false); }, [selected]);

  const classes = classOccurrences.filter(c => c.date === selected);
  const due = items.filter(i => i.work_status !== 'done' && dueDateOf(i) === selected);
  const entries = buildDayEntries(selected, classes, [], due);
  const meeting = classes.filter(c => !isSkippedClass(c)).length;
  const hours = Math.round(due.reduce((s, i) => s + Number(i.estimated_hours ?? 0), 0) * 10) / 10;
  const isToday = selected === todayStr;
  const short = fmt(selected, { weekday: 'short' });

  const head = [
    isToday ? `Today · ${short} ${monthDay(selected)}` : `${fmt(selected, { weekday: 'long' })} ${monthDay(selected)}`,
    due.length > 0 ? `${due.length} due` : null,
    meeting > 0 ? plural(meeting, 'class', 'classes') : null,
  ].filter(Boolean).join(' · ');

  // A completed row unmounts; keyboard focus lost with it lands on the day heading.
  const headRef = useRef<HTMLHeadingElement>(null);
  const focusWasIn = useRef(false);
  const dueSig = due.map(i => `${i.source}-${i.id}`).join('|');
  useEffect(() => {
    if (!focusWasIn.current) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    headRef.current?.focus();
    focusWasIn.current = false;
  }, [dueSig]);

  const addLabel = isToday ? 'Add for today' : `Add for ${short}`;

  return (
    <div
      className="vb-wd"
      onFocus={() => { focusWasIn.current = true; }}
      onBlur={e => {
        const to = e.relatedTarget;
        if (to instanceof Element && !e.currentTarget.contains(to)) focusWasIn.current = false;
      }}
    >
      <h3 ref={headRef} tabIndex={-1} className="vb-wd__head">{head}</h3>
      <div key={selected} className="vb-wd__list" data-instant={instant ? 'true' : undefined}>
        {due.length === 0 && (
          <p className="vb-wd__none">Nothing due{classes.length === 0 ? ', no classes' : ''}</p>
        )}
        {entries.length > 0 && (
          <ul className="vb-wd__rows">
            {entries.map(en => <DayRow key={entryKey(en)} en={en} onComplete={onComplete} onOpenDetail={onOpenDetail} />)}
          </ul>
        )}
      </div>
      <div className="vb-wd__foot">
        {hours > 0 && <span className="vb-wd__est">~{hours}h estimated</span>}
        {!adding && (
          <button type="button" className="wb-add-trigger wb-focus-ring vb-wd__add" onClick={() => setAdding(true)}>
            + {addLabel}
          </button>
        )}
      </div>
      <WbQuickAdd
        open={adding}
        onClose={() => setAdding(false)}
        label={addLabel}
        defaults={{ dueAt: selected }}
        filter={filter}
        courses={courses}
        onCreated={onChanged}
      />
      <style jsx>{`
        .vb-wd { margin-top: 14px; font-family: var(--wb-font-ui); color: var(--wb-text); }
        .vb-wd__head {
          margin: 0 0 6px; font: 800 var(--wb-fs-11) var(--wb-font-ui); letter-spacing: .06em;
          text-transform: uppercase; color: var(--wb-text-muted);
        }
        .vb-wd__head:focus { outline: none; }
        .vb-wd__head:focus-visible { outline: 2px solid var(--wb-blue-strong); outline-offset: 2px; border-radius: 4px; }
        .vb-wd__none { margin: 0; padding: 9px 4px; font: 500 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text-muted); }
        .vb-wd__rows { list-style: none; margin: 0; padding: 0; }
        .vb-wd__list { animation: vb-wd-fade var(--wb-dur-fast) var(--wb-ease); }
        .vb-wd__list[data-instant='true'] { animation: none; }
        @keyframes vb-wd-fade { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .vb-wd__list { animation: none; } }
        .vb-wd__foot { display: flex; align-items: center; gap: 8px; padding-top: 10px; }
        .vb-wd__est { font: 600 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-muted); }
        .vb-wd__add { margin-left: auto; }
      `}</style>
    </div>
  );
}

function DayRow({ en, onComplete, onOpenDetail }: {
  en: DayEntry; onComplete: (item: WorkItem) => void; onOpenDetail: (item: WorkItem) => void;
}) {
  if (en.kind === 'event') return null;
  let body: React.ReactNode;
  if (en.kind === 'class') {
    const c = en.c;
    const skipped = isSkippedClass(c);
    const struck = skipped ? 'true' : undefined;
    body = (
      <>
        <span className="vb-wr__bar" aria-hidden />
        <span className="vb-wr__code" data-struck={struck}>{c.course_code}</span>
        <span className="vb-wr__time" data-struck={struck}>
          {formatClock(en.start)}–{formatClock(toMinutes(c.end_time))}
        </span>
        {skipped && (
          <span className="vb-wr__time">· {c.override?.modality === 'cancelled' ? 'cancelled' : 'moved'}</span>
        )}
      </>
    );
  } else {
    const item = en.item;
    const high = item.priority === 'high';
    const pill = isWaitingStage(item.work_stage) || item.blocked_since ? waitingLabel(item.work_stage, item.blocked_reason) : null;
    body = (
      <>
        <WbCheckbox
          shape="round"
          size={18}
          checked={false}
          ring={high}
          label={`Complete "${item.title}"${high ? ' (high priority)' : ''}`}
          onChange={() => onComplete(item)}
        />
        <button type="button" className="vb-wr__title wb-focus-ring" title={item.title} onClick={() => onOpenDetail(item)}>
          {item.title}
        </button>
        {pill && (
          <span
            className="wb-gpill vb-wr__pill"
            style={{ color: isRevisionStage(item.work_stage) ? 'var(--wb-ctx-project-text)' : 'var(--wb-warn)' }}
            title={pill}
          >
            {pill}
          </span>
        )}
      </>
    );
  }
  return (
    <li className="vb-wr">
      {body}
      <style jsx>{`
        .vb-wr { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 4px; }
        .vb-wr + .vb-wr { border-top: 1px solid var(--wb-hairline); }
        .vb-wr :global(.vb-wr__title) {
          flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; cursor: pointer; text-align: left;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          font: 500 var(--wb-fs-14) var(--wb-font-ui); color: var(--wb-text);
        }
        .vb-wr :global(.vb-wr__pill) { min-width: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; }
        .vb-wr :global(.vb-wr__bar) { width: 6px; height: 16px; margin: 0 6px; border-radius: 3px; background: var(--wb-blue); flex: none; }
        .vb-wr :global(.vb-wr__code) {
          flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font: 600 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text-muted);
        }
        .vb-wr :global(.vb-wr__time) { flex: none; white-space: nowrap; font: 600 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-muted); }
        .vb-wr :global([data-struck='true']) { text-decoration: line-through; }
      `}</style>
    </li>
  );
}
