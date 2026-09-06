'use client';

import { useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { WorkItem, WorkStatus, WorkCategory } from '@/lib/workboard/workItems';
import { courseColor } from '@/lib/workboard/color';

/** Local copies of workItems.ts's `dueDateOf` and aggregate.ts's `addDays` — duplicated
 *  rather than imported, deliberately. Both of those modules import `pool` from '@/lib/db'
 *  at module scope for their (unrelated) DB-access exports; a 'use client' file that
 *  imports a runtime value from either one pulls mysql2 (and Node's `net`) into the
 *  browser bundle and breaks the page. `WorkboardWeekView.tsx` already works around this
 *  the same way with its own local `addDaysLocal` — same fix, same reason. */
function dueDateOf(item: WorkItem): string | null {
  return item.due_at ? item.due_at.slice(0, 10) : null;
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Owned items and Study-Pulse-sourced items have different write endpoints. This is the
 *  single place that decision is made — no view should build these URLs itself. */
export async function setWorkStatus(item: WorkItem, next: WorkStatus): Promise<Response> {
  const url = item.source === 'owned'
    ? `/api/workboard/work-items/${item.id}`
    : `/api/workboard/academic/${item.source}/${item.id}`;
  return fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_status: next }),
  });
}

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";

const CATEGORY_META: Record<WorkCategory, { label: string; bg: string; text: string }> = {
  academic:     { label: 'Academic',     bg: 'rgba(77,171,245,0.16)',  text: '#185a7d' },
  project:      { label: 'Projects',     bg: 'rgba(139,127,214,0.16)', text: '#4f3fa0' },
  organization: { label: 'Organization', bg: 'rgba(240,163,92,0.16)',  text: '#8a5010' },
  life:         { label: 'Life',         bg: 'rgba(242,167,192,0.16)', text: '#8a4468' },
};

const EDGE_COLOR: Record<WorkItem['priority'], string> = {
  high:   '#e0607c',
  normal: '#b8c6da',
  low:    '#d3dbe6',
};

/** "Due today" / "Due tomorrow" / "Overdue" / "Due Sep 12" — never a bare ISO date, per the
 *  direction doc's row meta line. `due` and `todayStr` are both "YYYY-MM-DD" so string
 *  comparison is safe (see WorkItem.due_at's doc comment: never parse these as Date). */
function formatDueLabel(due: string | null, todayStr: string): string | null {
  if (due === null) return null;
  if (due < todayStr) return 'Overdue';
  if (due === todayStr) return 'Due today';
  if (due === addDays(todayStr, 1)) return 'Due tomorrow';
  const d = new Date(`${due}T00:00:00Z`);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `Due ${month} ${d.getUTCDate()}`;
}

/** The row's single meta string — due label + estimate, joined by " · " — and whether it
 *  should render in the overdue alert color. Computed once and reused by both the desktop
 *  (meta line under the title) and mobile (meta folded into line 2) layouts so the two never
 *  disagree about what the row is telling the user. */
function buildMeta(item: WorkItem, todayStr: string): { text: string | null; overdue: boolean } {
  const due = dueDateOf(item);
  const dueLabel = formatDueLabel(due, todayStr);
  const estimateLabel = item.estimated_hours !== null ? `${item.estimated_hours}h` : null;
  const parts = [dueLabel, estimateLabel].filter((p): p is string => p !== null);
  const overdue = due !== null && due < todayStr;
  return { text: parts.length ? parts.join(' · ') : null, overdue };
}

function CategoryChip({ category }: { category: WorkCategory }) {
  const meta = CATEGORY_META[category];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '3px 10px',
      background: meta.bg, color: meta.text, fontFamily: FONT, fontSize: '0.68rem', fontWeight: 700,
      textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {meta.label}
    </span>
  );
}

function ProjectChip({ label }: { label: string }) {
  const dot = courseColor(label);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px', borderRadius: '6px',
      padding: '2px 8px 2px 6px', background: 'rgba(255,255,255,0.55)',
      border: '1px solid rgba(200,210,230,0.4)', fontFamily: FONT, fontSize: '0.68rem',
      fontWeight: 500, color: '#5c6b80', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dot, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function HighPriorityPill() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '2px 9px',
      background: 'rgba(224,96,124,0.15)', color: '#922e48', fontFamily: FONT, fontSize: '0.64rem',
      fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      High
    </span>
  );
}

export interface WorkItemRowProps {
  item:       WorkItem;
  /** "YYYY-MM-DD" — `work.generated_at`, so every row in the payload agrees on "today". */
  todayStr:   string;
  /** `>=1024px` single-line layout vs the `<1024px` two-line layout (direction doc §3 vs §10). */
  isDesktop:  boolean;
  /** Suppresses the row's bottom divider — the last row in a section has none. */
  isLast:     boolean;
  onChanged:  () => void | Promise<void>;
}

export default function WorkItemRow({ item, todayStr, isDesktop, isLast, onChanged }: WorkItemRowProps) {
  const [pending, setPending] = useState(false);
  const meta = buildMeta(item, todayStr);
  const edgeColor = EDGE_COLOR[item.priority];
  const divider = isLast ? 'none' : '1px solid rgba(200,210,230,0.35)';

  const handleToggle = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await setWorkStatus(item, 'done');
      if (res.ok) {
        await onChanged();
      } else {
        console.error('Failed to update work item status', await res.text().catch(() => res.statusText));
      }
    } finally {
      setPending(false);
    }
  };

  const checkbox = (
    <label style={{
      width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, cursor: pending ? 'default' : 'pointer',
    }}>
      <input
        type="checkbox"
        className="vb-row-checkbox"
        checked={false}
        disabled={pending}
        onChange={handleToggle}
        aria-label={`Mark "${item.title}" as done`}
        style={{ width: '20px', height: '20px', cursor: pending ? 'default' : 'pointer', accentColor: '#256f92' }}
      />
    </label>
  );

  const overflowButton = (
    <button
      type="button"
      className="vb-row-overflow"
      aria-label="More options"
      title="More options"
      style={{
        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none', borderRadius: '8px', color: '#5c6b80',
        cursor: 'pointer', flexShrink: 0,
      }}
    >
      <MoreVertical size={16} />
    </button>
  );

  return (
    <div
      className="vb-work-row"
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', width: '100%',
        padding: '8px 4px', minHeight: isDesktop ? '56px' : '82px', borderBottom: divider,
        borderRadius: '8px', boxSizing: 'border-box',
      }}
    >
      <span
        aria-hidden
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', background: edgeColor, borderRadius: '2px' }}
      />

      {isDesktop ? (
        <>
          <div style={{ marginLeft: '3px' }}>{checkbox}</div>

          <div style={{ marginLeft: '12px', minWidth: 0, maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span
              title={item.title}
              style={{
                fontFamily: FONT, fontSize: '0.88rem', fontWeight: 600, color: '#2d3748',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {item.title}
            </span>
            {meta.text && (
              <span style={{ fontFamily: FONT, fontSize: '0.76rem', fontWeight: 500, color: meta.overdue ? '#922e48' : '#5c6b80' }}>
                {meta.text}
              </span>
            )}
          </div>

          <div style={{ flex: 1, minWidth: '12px' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <CategoryChip category={item.category} />
            {item.chip_label && <ProjectChip label={item.chip_label} />}
          </div>

          <div style={{ marginLeft: '12px', display: 'flex', alignItems: 'center' }}>
            {item.priority === 'high' && <HighPriorityPill />}
          </div>

          <div style={{ marginLeft: '8px' }}>{overflowButton}</div>
        </>
      ) : (
        <div style={{ marginLeft: '3px', display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {checkbox}
            <span
              title={item.title}
              style={{
                marginLeft: '12px', flex: 1, minWidth: 0, fontFamily: FONT, fontSize: '0.88rem', fontWeight: 600,
                color: '#2d3748', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {item.title}
            </span>
            {item.priority === 'high' && <span style={{ marginLeft: '8px' }}><HighPriorityPill /></span>}
            <span style={{ marginLeft: 'auto', paddingLeft: '8px' }}>{overflowButton}</span>
          </div>

          <div style={{ marginLeft: '52px', marginTop: '6px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
            <CategoryChip category={item.category} />
            {item.chip_label && <ProjectChip label={item.chip_label} />}
            {meta.text && (
              <span style={{ fontFamily: FONT, fontSize: '0.76rem', fontWeight: 500, color: meta.overdue ? '#922e48' : '#5c6b80' }}>
                {meta.text}
              </span>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .vb-work-row { background: transparent; transition: background 120ms ease; }
        .vb-work-row:hover, .vb-work-row:focus-within { background: rgba(116,188,217,0.06); }
        .vb-row-checkbox:focus-visible { outline: 2px solid #2a7fa8; outline-offset: 2px; border-radius: 4px; }
        .vb-row-overflow:focus-visible { outline: 2px solid #2a7fa8; outline-offset: 2px; }
        .vb-row-overflow:hover { background: rgba(200,210,230,0.3); }
      `}</style>
    </div>
  );
}
