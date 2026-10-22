'use client';

import type { WorkItem } from '@/lib/workboard/workItems';
import WbCheckbox from '../ui/WbCheckbox';
import { RowOverflowMenu } from '../WorkItemRow';
import { courseColor, courseTextColor } from '@/lib/workboard/color';
import { CONTEXT_FILL, CONTEXT_TEXT } from '@/lib/workboard/ui/tokens';
import { dueStateOf, formatDueLabel } from '@/lib/workboard/dueSemantics';
import { daysSince } from '@/lib/workboard/dates';
import { CONTEXT_LABELS, waitingLabel } from '@/lib/workboard/workContexts';
import { shortCourseCode } from '@/lib/workboard/ui/courseCode';

export interface FocusRowProps {
  item: WorkItem;
  todayStr: string;
  onComplete: (item: WorkItem) => void;
  onOpenDetail: (item: WorkItem) => void;
  onEdit: (item: WorkItem) => void;
  variant?: 'default' | 'waiting';
}

export function contextChip(item: WorkItem): { label: string; fill: string; text: string } {
  if (item.course_code) {
    return { label: item.course_code, fill: courseColor(item.course_code), text: courseTextColor(item.course_code) };
  }
  // Every row shows a context marker: fall back to the context's own name.
  const label = item.chip_label || item.project_name || item.organization_name || CONTEXT_LABELS[item.context];
  return { label, fill: CONTEXT_FILL[item.context], text: CONTEXT_TEXT[item.context] };
}

export default function FocusRow({ item, todayStr, onComplete, onOpenDetail, onEdit, variant = 'default' }: FocusRowProps) {
  const chip = contextChip(item);
  const state = dueStateOf(item, todayStr);
  const due = formatDueLabel(item, todayStr);
  const done = item.work_status === 'done';
  const high = item.priority === 'high';
  const waitingText = variant === 'waiting'
    ? waitingLabel(item.work_stage, item.blocked_reason)
      + (item.blocked_since ? ` · ${daysSince(item.blocked_since.slice(0, 10), todayStr)}d` : '')
    : null;
  return (
    <div className="wb-frow wb-hoverable">
      <WbCheckbox
        shape="round"
        checked={done}
        ring={high}
        label={`Complete "${item.title}"${high ? ' (high priority)' : ''}`}
        onChange={() => onComplete(item)}
      />
      <button type="button" className="wb-frow__title wb-focus-ring" title={item.title} onClick={() => onOpenDetail(item)}>
        {item.title}
      </button>
      {waitingText !== null ? (
        // The full reason stays in the DOM (read in full by screen readers) and in `title`.
        <span className="wb-frow__meta wb-frow__wait" style={{ color: 'var(--wb-warn)' }} title={waitingText}>
          {waitingText}
        </span>
      ) : (
        <>
          {chip.label && (
            <span className="wb-frow__ctx" style={{ color: chip.text }} title={chip.label}>
              <span className="wb-frow__dot" style={{ background: chip.fill }} aria-hidden />
              {/* Up next and the Table show the short course code too; the full code stays in `title`. */}
              <span className="wb-frow__ctx-text">{item.course_code ? shortCourseCode(item.course_code) : chip.label}</span>
            </span>
          )}
          {due && (
            <span className="wb-frow__meta" style={{ color: state === 'overdue' ? 'var(--wb-danger)' : 'var(--wb-text-muted)' }}>
              {due}
            </span>
          )}
          {item.estimated_hours != null && (
            <span className="wb-frow__meta wb-frow__est">~{Number(item.estimated_hours)}h</span>
          )}
        </>
      )}
      <span className="wb-frow__actions">
        <RowOverflowMenu
          triggerAriaLabel={`More actions for "${item.title}"`}
          menuAriaLabel={`Actions for "${item.title}"`}
          items={[
            { key: 'open', label: 'Open details', onClick: () => onOpenDetail(item) },
            { key: 'edit', label: 'Edit', onClick: () => onEdit(item) },
          ]}
        />
      </span>
      <style jsx>{`
        .wb-frow {
          display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 6px;
          border-radius: var(--wb-r-md); font-family: var(--wb-font-ui);
        }
        .wb-frow__title {
          flex: 1; min-width: 0; text-align: left; border: 0; background: transparent; padding: 0; cursor: pointer;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          font: 500 var(--wb-fs-14) var(--wb-font-ui); color: var(--wb-text);
        }
        .wb-frow__ctx {
          display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; max-width: 120px; min-width: 0;
          font: 800 var(--wb-fs-11) var(--wb-font-ui); letter-spacing: .03em; text-transform: uppercase;
        }
        .wb-frow__ctx-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .wb-frow__dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .wb-frow__meta { font: 600 var(--wb-fs-12) var(--wb-font-ui); white-space: nowrap; }
        .wb-frow__est { color: var(--wb-text-muted); min-width: 32px; text-align: right; }
        .wb-frow__wait { flex: 0 1 auto; min-width: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; }
        .wb-frow__actions { opacity: 0; transition: opacity var(--wb-dur-fast) var(--wb-ease); }
        .wb-frow:focus-within .wb-frow__actions { opacity: 1; }
        @media (hover: hover) and (pointer: fine) { .wb-frow:hover .wb-frow__actions { opacity: 1; } }
        @media (hover: none) { .wb-frow__actions { opacity: 1; } }
        @media (max-width: 767px) {
          .wb-frow { height: auto; min-height: 44px; flex-wrap: wrap; row-gap: 2px; padding: 4px 6px; }
          .wb-frow__title { flex-basis: calc(100% - 100px); }
          .wb-frow__ctx { margin-left: 50px; }
          .wb-frow__wait { margin-left: 50px; max-width: calc(100% - 50px); }
          .wb-frow__est { display: none; }
        }
      `}</style>
    </div>
  );
}
