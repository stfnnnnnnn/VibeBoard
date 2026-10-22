'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, X } from 'lucide-react';
// Type-only: `workItems.ts` and `aggregate.ts` reach `pool` at module scope (see WorkTimelineView).
import type { WorkItem } from '@/lib/workboard/workItems';
import type { ClassOccurrence, WorkboardEventItem } from '@/lib/workboard/aggregate';
import type { WorkContext } from '@/lib/workboard/workContexts';
import type { CourseOption } from '@/lib/workboard/ui/quickAdd';
import { dueStateOf } from '@/lib/workboard/dueSemantics';
import { courseColor } from '@/lib/workboard/color';
import { formatClock, useNowMinutes } from '@/lib/workboard/ui/nowMinutes';
import { formatShortDate, type AnchorRect } from '@/components/schedule/ClassOverridePopover';
import WbQuickAdd from '../ui/WbQuickAdd';
import { contextChip } from './FocusRow';
import {
  buildDayEntries, entryKey, isSkippedClass, minutesOfDateTime, nowSlot, toMinutes, type DayEntry,
} from '@/lib/workboard/ui/dayEntries';

function longDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function weekdayOf(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

function classState(c: ClassOccurrence): string | null {
  const ov = c.override;
  if (c.moved_from) return `From ${formatShortDate(c.moved_from)}`;
  if (!ov) return null;
  switch (ov.modality) {
    case 'cancelled':    return 'Cancelled';
    case 'online_sync':  return 'Online (sync)';
    case 'online_async': return 'Online (async)';
    case 'rescheduled':  return ov.moved_date ? `Moved to ${formatShortDate(ov.moved_date)}` : 'Moved';
    default:             return null;
  }
}

export interface TimelineDayPanelProps {
  date: string;
  today: string;
  classes: ClassOccurrence[];
  items: WorkItem[];
  events: WorkboardEventItem[];
  filter: WorkContext | 'all';
  courses: CourseOption[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onOpenDetail: (item: WorkItem) => void;
  onEditClass: (c: ClassOccurrence, anchor: AnchorRect, trigger: HTMLElement) => void;
  onEditEvent: (e: WorkboardEventItem) => void;
  /** Changes when the user switches day; remounts (and crossfades) the agenda only. */
  switchKey: string;
}

export default function TimelineDayPanel({
  date, today, classes, items, events, filter, courses,
  onClose, onChanged, onOpenDetail, onEditClass, onEditEvent, switchKey,
}: TimelineDayPanelProps) {
  const now = useNowMinutes();
  const [adding, setAdding] = useState(false);
  // A half-typed title must not silently move to a different day.
  useEffect(() => { setAdding(false); }, [switchKey]);

  const isToday = date === today;
  const entries = buildDayEntries(date, classes, events, items);
  const slot = isToday && now !== null ? nowSlot(entries, now) : -1;

  const done = items.filter(i => i.work_status === 'done').length;
  const classMinutes = classes
    .filter(c => !isSkippedClass(c))
    .reduce((sum, c) => sum + Math.max(0, toMinutes(c.end_time) - toMinutes(c.start_time)), 0);
  const hours = Math.round((classMinutes / 60) * 10) / 10;
  const weekday = weekdayOf(date);
  const parts: string[] = [];
  if (items.length > 0) parts.push(`${done} of ${items.length} done`);
  if (hours > 0) parts.push(`${hours}h scheduled`);
  if (parts.length === 0 && events.length > 0) parts.push(`${events.length} event${events.length === 1 ? '' : 's'}`);
  // The agenda still lists skipped classes, so name them instead of calling the day free.
  if (hours === 0) {
    const cancelled = classes.filter(c => c.override?.modality === 'cancelled').length;
    const moved = classes.filter(c => isSkippedClass(c)).length - cancelled;
    if (cancelled > 0) parts.push(`${cancelled} class${cancelled === 1 ? '' : 'es'} cancelled`);
    if (moved > 0) parts.push(`${moved} class${moved === 1 ? '' : 'es'} moved`);
  }
  if (parts.length === 0) parts.push('Free day');
  const summary = (isToday ? ['Today', ...parts] : parts).join(' · ');

  const rows: React.ReactNode[] = entries.map(en => <AgendaRow key={entryKey(en)} en={en} date={date} today={today}
    onOpenDetail={onOpenDetail} onEditClass={onEditClass} onEditEvent={onEditEvent} />);
  if (slot !== -1 && now !== null) {
    rows.splice(slot, 0, (
      <li key="now" role="separator" aria-label={`Now, ${formatClock(now)}`} className="vb-day-now">
        <span className="vb-day-time vb-day-now__label" aria-hidden>now</span>
        <span className="vb-day-now__line" aria-hidden />
      </li>
    ));
  }

  return (
    <div className="vb-day-root">
      <div className="vb-day-head">
        <div style={{ minWidth: 0 }}>
          <h3 id="vb-day-panel-title" className="vb-day-title">{longDate(date)}</h3>
          <p className="vb-day-sub">
            {summary}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close day agenda" className="wb-add-trigger wb-focus-ring vb-day-close">
          <X size={16} aria-hidden />
        </button>
      </div>

      <div key={switchKey} className="vb-day-fade">
        {rows.length > 0 && <ol className="vb-day-list">{rows}</ol>}
      </div>

      <div className="vb-day-foot">
        {!adding && (
          <button type="button" className="wb-add-trigger wb-focus-ring" onClick={() => setAdding(true)}>
            + Add to {weekday}
          </button>
        )}
        <WbQuickAdd
          open={adding}
          onClose={() => setAdding(false)}
          label={`Add to ${weekday}`}
          defaults={{ dueAt: date }}
          filter={filter}
          courses={courses}
          onCreated={onChanged}
        />
      </div>

      <style jsx>{`
        .vb-day-root { display: flex; flex-direction: column; gap: 10px; font-family: var(--wb-font-ui); color: var(--wb-text); }
        .vb-day-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .vb-day-title { margin: 0; font: 800 var(--wb-fs-16) var(--wb-font-head); color: var(--wb-text); }
        .vb-day-sub { margin: 2px 0 0; font: 500 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-muted); }
        .vb-day-close { display: inline-grid; place-items: center; color: var(--wb-text-muted); flex-shrink: 0; }
        .vb-day-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
        .vb-day-foot { border-top: 1px solid var(--wb-hairline); padding-top: 8px; }
        .vb-day-fade { animation: vb-day-fade var(--wb-dur-fast) var(--wb-ease); }
        @keyframes vb-day-fade { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .vb-day-fade { animation: none; } }
      `}</style>
    </div>
  );
}

function AgendaRow({
  en, date, today, onOpenDetail, onEditClass, onEditEvent,
}: {
  en: DayEntry; date: string; today: string;
  onOpenDetail: (item: WorkItem) => void;
  onEditClass: (c: ClassOccurrence, anchor: AnchorRect, trigger: HTMLElement) => void;
  onEditEvent: (e: WorkboardEventItem) => void;
}) {
  let time: string;
  let title: React.ReactNode;
  let detail: string;
  let edge: string;
  let onClick: (el: HTMLButtonElement) => void;
  let struck = false;

  if (en.kind === 'class') {
    const c = en.c;
    struck = isSkippedClass(c);
    time = formatClock(en.start);
    title = c.subject_name ? `${c.course_code} · ${c.subject_name}` : c.course_code;
    detail = [c.override?.room ?? c.venue, c.instructor, `until ${formatClock(toMinutes(c.end_time))}`, classState(c)]
      .filter(Boolean).join(' · ');
    edge = courseColor(c.course_code);
    onClick = el => onEditClass(c, el.getBoundingClientRect(), el);
  } else if (en.kind === 'event') {
    const e = en.e;
    time = en.start === null ? '—' : formatClock(en.start);
    const end = e.ends_at && e.ends_at.slice(0, 10) === date ? `until ${formatClock(minutesOfDateTime(e.ends_at))}` : null;
    title = (
      <>
        {e.item_type === 'reminder' && <Bell size={12} aria-hidden style={{ marginRight: 4, verticalAlign: '-1px' }} />}
        {e.title}
      </>
    );
    detail = [e.location, end].filter(Boolean).join(' · ');
    edge = 'var(--wb-ctx-life)';
    onClick = () => onEditEvent(e);
  } else {
    const item = en.item;
    const overdue = dueStateOf(item, today) === 'overdue';
    struck = item.work_status === 'done';
    time = en.start === null ? 'Due' : formatClock(en.start);
    const chip = contextChip(item);
    title = overdue ? (
      <span style={{ color: 'var(--wb-danger)' }}>
        <AlertTriangle size={13} aria-label="Overdue" style={{ marginRight: 4, verticalAlign: '-2px' }} />
        {item.title}
      </span>
    ) : item.title;
    detail = [chip.label, item.estimated_hours ? `~${item.estimated_hours}h` : null].filter(Boolean).join(' · ');
    // The dot means context or course here, as it does on Board, Up next and Table.
    edge = chip.fill;
    onClick = () => onOpenDetail(item);
  }

  return (
    <li>
      <button type="button" className="vb-day-row wb-focus-ring" onClick={e => onClick(e.currentTarget)}>
        <span className="vb-day-time">{time}</span>
        <span className="vb-day-body">
          <span className="wb-gdot vb-day-dot" style={{ '--dot': edge } as React.CSSProperties} aria-hidden />
          <span className="vb-day-text">
            <span className="vb-day-row-title" data-struck={struck ? 'true' : undefined}>{title}</span>
            {detail && <span className="vb-day-detail">{detail}</span>}
          </span>
        </span>
      </button>
      <style jsx>{`
        .vb-day-row {
          display: grid; grid-template-columns: 52px 1fr; align-items: start; width: 100%;
          padding: 7px 4px; border: 0; border-bottom: 1px solid var(--wb-hairline); border-radius: var(--wb-r-sm);
          background: transparent; text-align: left; cursor: pointer; font-family: var(--wb-font-ui);
        }
        .vb-day-body { display: flex; align-items: flex-start; gap: 9px; min-width: 0; padding-left: 4px; }
        /* Centred on the title's first line (13px type). */
        .vb-day-dot { margin-top: 5px; }
        .vb-day-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .vb-day-row-title { font: 600 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text); overflow-wrap: anywhere; }
        .vb-day-row-title[data-struck='true'] { text-decoration: line-through; color: var(--wb-text-faint); }
        .vb-day-detail { font: 500 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-muted); overflow-wrap: anywhere; }
        @media (hover: hover) and (pointer: fine) {
          .vb-day-row:hover { background: var(--wb-selected); }
        }
      `}</style>
    </li>
  );
}
