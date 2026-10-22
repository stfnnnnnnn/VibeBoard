'use client';

import { useState } from 'react';
import { Link2 } from 'lucide-react';
import type { WorkItem } from '@/lib/workboard/workItems';
import WbCheckbox from '../ui/WbCheckbox';
import DeadlineCell, { type DeadlineEditor } from '../table/DeadlineCell';
import { contextChip } from './FocusRow';
import { shortCourseCode } from '@/lib/workboard/ui/courseCode';
import { dueStateOf, formatDeadline, formatDeadlineTime, formatDueLabel, type DueState } from '@/lib/workboard/dueSemantics';
import { addDays, daysSince, dueDateOf } from '@/lib/workboard/dates';
import { waitingLabel } from '@/lib/workboard/workContexts';

/** `viaKeyboard` is `e.detail === 0` on the click: keyboard completions skip the promotion crossfade. */
type CompleteFn = (item: WorkItem, viaKeyboard: boolean) => void;

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function dueColor(state: DueState): string {
  if (state === 'overdue') return 'var(--wb-danger)';
  if (state === 'due_today') return 'var(--wb-pink-ink)';
  return 'var(--wb-text-muted)';
}

/** "OVERDUE · 105 DAYS", "TODAY · 11:59 PM", "TOMORROW" or "THU". */
function eyebrow(item: WorkItem, today: string): { text: string; color: string } {
  const state = dueStateOf(item, today);
  const due = dueDateOf(item);
  if (state === 'overdue' && due) {
    const n = daysSince(due, today);
    return { text: `Overdue · ${n} ${n === 1 ? 'day' : 'days'}`, color: 'var(--wb-danger)' };
  }
  if (state === 'due_today') {
    return { text: item.deadline_time ? `Today · ${formatDeadlineTime(item)}` : 'Today', color: 'var(--wb-pink-ink)' };
  }
  // Defensive only: rankUpNext never returns an undated item.
  if (due === null) return { text: 'No deadline', color: 'var(--wb-text-muted)' };
  // A past-due revision item ranks with today but is never overdue: name its date instead.
  if (due < today) return { text: formatDeadline(item) ?? '', color: 'var(--wb-text-muted)' };
  if (due === addDays(today, 1)) return { text: 'Tomorrow', color: 'var(--wb-text-muted)' };
  return { text: WEEKDAYS[new Date(`${due}T00:00:00Z`).getUTCDay()], color: 'var(--wb-text-muted)' };
}

function ContextPill({ item, className }: { item: WorkItem; className?: string }) {
  const chip = contextChip(item);
  const label = item.course_code ? shortCourseCode(item.course_code) : chip.label;
  if (!label) return null;
  return (
    <span className={`wb-gpill${className ? ` ${className}` : ''}`} title={item.course_code ?? chip.label}>
      <span className="wb-gdot wb-gdot--flat" style={{ '--dot': chip.fill } as React.CSSProperties} aria-hidden />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </span>
  );
}

export interface UpNextHeroProps {
  item: WorkItem;
  todayStr: string;
  onComplete: CompleteFn;
  onOpenDetail: (item: WorkItem) => void;
  /** The Reschedule button's editor, from `useDeadlineEditor` (one per `WorkListView`). */
  editor: DeadlineEditor;
  /** Mount without the promotion crossfade (first paint, or a keyboard completion). */
  instant?: boolean;
}

export function UpNextHero({ item, todayStr, onComplete, onOpenDetail, editor, instant }: UpNextHeroProps) {
  // Frozen at mount: the flag only governs this hero's entrance, never a later re-render.
  const [mountInstant] = useState(instant);
  const brow = eyebrow(item, todayStr);
  const state = dueStateOf(item, todayStr);
  const due = formatDueLabel(item, todayStr);
  const high = item.priority === 'high';
  const waiting = item.blocked_since ? waitingLabel(item.work_stage, item.blocked_reason) : null;

  return (
    <div className="vb-hero wb-glass-item vb-upnext-hero" data-instant={mountInstant ? 'true' : undefined}>
      <span className="vb-hero__brow" style={{ color: brow.color }}>{brow.text}</span>
      <div className="vb-hero__body">
        <WbCheckbox
          shape="round"
          size={22}
          checked={item.work_status === 'done'}
          ring={high}
          label={`Complete "${item.title}"${high ? ' (high priority)' : ''}`}
          onChange={(_next, e) => onComplete(item, e.detail === 0)}
        />
        <div className="vb-hero__main">
          <button type="button" className="vb-hero__title wb-focus-ring" title={item.title} onClick={() => onOpenDetail(item)}>
            {item.title}
          </button>
          <div className="vb-hero__meta">
            <ContextPill item={item} />
            {due && <span className="vb-hero__m" style={{ color: dueColor(state) }}>{due}</span>}
            {item.estimated_hours != null && <span className="vb-hero__m">~{Number(item.estimated_hours)}h</span>}
            {item.link_count > 0 && (
              <span className="vb-hero__m">
                <Link2 size={13} aria-hidden /> {item.link_count}
                <span className="wb-sr-only">{item.link_count === 1 ? ' link' : ' links'}</span>
              </span>
            )}
            {waiting && <span className="vb-hero__m vb-hero__wait" style={{ color: 'var(--wb-warn)' }} title={waiting}>{waiting}</span>}
          </div>
          <div className="vb-hero__actions">
            <button
              type="button"
              className="wb-gbtn wb-gbtn--dark wb-focus-ring"
              onClick={e => onComplete(item, e.detail === 0)}
            >
              <span className="vb-hero__wide">Mark done</span>
              <span className="vb-hero__narrow">Done</span>
              <span className="wb-sr-only">: {item.title}</span>
            </button>
            <DeadlineCell item={item} column="deadline" variant="button" todayStr={todayStr} editor={editor} />
            <button type="button" className="wb-gbtn wb-focus-ring vb-hero__wide" onClick={() => onOpenDetail(item)}>
              Open
            </button>
          </div>
        </div>
      </div>
      <style jsx>{`
        .vb-hero { padding: 16px 18px; margin-bottom: 8px; border-radius: 16px; font-family: var(--wb-font-ui); }
        .vb-hero__brow { display: block; font: 800 var(--wb-fs-11) var(--wb-font-ui); letter-spacing: .05em; text-transform: uppercase; }
        .vb-hero__body { display: flex; gap: 12px; align-items: flex-start; margin-top: 6px; }
        .vb-hero__main { flex: 1; min-width: 0; }
        .vb-hero__title {
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
          width: 100%; margin: 2px 0 6px; padding: 0; border: 0; background: transparent; cursor: pointer; text-align: left;
          font: 650 16px/1.35 var(--wb-font-ui); color: var(--wb-text); overflow-wrap: anywhere;
        }
        .vb-hero__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .vb-hero__m {
          display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
          font: 600 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-muted);
        }
        .vb-hero__wait { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; display: inline-block; }
        .vb-hero__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .vb-hero__narrow { display: none; }
        @media (max-width: 767px) {
          .vb-hero { padding: 14px; }
          .vb-hero__wide { display: none; }
          .vb-hero__narrow { display: inline; }
        }
      `}</style>
    </div>
  );
}

export interface UpNextCardProps {
  item: WorkItem;
  todayStr: string;
  onComplete: CompleteFn;
  onOpenDetail: (item: WorkItem) => void;
}

export function UpNextCard({ item, todayStr, onComplete, onOpenDetail }: UpNextCardProps) {
  const state = dueStateOf(item, todayStr);
  const due = formatDueLabel(item, todayStr);
  const high = item.priority === 'high';
  return (
    <div className="vb-unc wb-glass-item wb-glass-item--hoverable">
      <WbCheckbox
        shape="round"
        size={18}
        checked={item.work_status === 'done'}
        ring={high}
        label={`Complete "${item.title}"${high ? ' (high priority)' : ''}`}
        onChange={(_next, e) => onComplete(item, e.detail === 0)}
      />
      <button type="button" className="vb-unc__title wb-focus-ring" title={item.title} onClick={() => onOpenDetail(item)}>
        {item.title}
      </button>
      <ContextPill item={item} className="vb-unc__ctx" />
      {due && <span className="vb-unc__due" style={{ color: dueColor(state) }}>{due}</span>}
      <style jsx>{`
        .vb-unc { display: flex; align-items: center; gap: 10px; padding: 11px 14px; margin-bottom: 8px; font-family: var(--wb-font-ui); }
        .vb-unc__title {
          flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; cursor: pointer; text-align: left;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          font: 500 var(--wb-fs-14) var(--wb-font-ui); color: var(--wb-text);
        }
        .vb-unc :global(.vb-unc__ctx) { max-width: 140px; }
        .vb-unc__due { flex: none; white-space: nowrap; font: 600 var(--wb-fs-12) var(--wb-font-ui); }
        @media (max-width: 767px) {
          .vb-unc { padding: 6px 12px 6px 6px; }
          .vb-unc :global(.vb-unc__ctx) { display: none; }
        }
      `}</style>
    </div>
  );
}
