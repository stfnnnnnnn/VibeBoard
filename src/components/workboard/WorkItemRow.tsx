'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { WorkItem, WorkStatus, WorkCategory, WorkPriority } from '@/lib/workboard/workItems';
// Pool-free by construction (`workContexts.ts` has no imports at all), so a `WorkStage` value
// import cannot drag mysql2 into this client bundle the way `workItems.ts` would.
import type { WorkStage } from '@/lib/workboard/workContexts';
import { courseColor } from '@/lib/workboard/color';
import { dueStateOf, formatDueLabel, type DueState } from '@/lib/workboard/dueSemantics';

/** Owned items and Study-Pulse-sourced items have different write endpoints. This is the
 *  single place that decision is made — no view should build these URLs itself. */
function writeUrl(item: WorkItem): string {
  return item.source === 'owned'
    ? `/api/workboard/work-items/${item.id}`
    : `/api/workboard/academic/${item.source}/${item.id}`;
}

export async function setWorkStatus(item: WorkItem, next: WorkStatus): Promise<Response> {
  return fetch(writeUrl(item), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_status: next }),
  });
}

/**
 * The stage-level sibling of `setWorkStatus`, sharing its endpoint routing so the Board never
 * builds a URL of its own. Both endpoints keep `work_stage` and `work_status` in sync by
 * construction, so a stage write must NOT also send `work_status`: on the owned route a
 * status equal to the item's current one is dropped from the update set (and a body that
 * contained only that would 400 "No fields to update"), and on the academic route an explicit
 * `work_stage` deliberately outranks a bare `work_status` — sending both would just add a
 * value that loses. Sending the stage alone is the whole message on both paths.
 */
export async function setWorkStage(item: WorkItem, next: WorkStage): Promise<Response> {
  return fetch(writeUrl(item), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_stage: next }),
  });
}

/**
 * The third sibling, sharing the same endpoint routing so the Table's priority cell never
 * builds a URL of its own. `priority` is the whole message: both routes treat a PATCH body
 * as a sparse patch, so sending anything else here would put a second field's fate in this
 * function's hands.
 *
 * The two routes store it in different places, and that asymmetry is intended rather than
 * incidental. An owned item's priority is its own `workboard_work_items.priority` column. An
 * academic item has no Workboard column for it: `patchAcademicItem` maps the value through
 * `urgencyFromPriority` into **Study Pulse's own `urgency` column** — the same column
 * `priorityFromUrgency` reads it back out of — not into the `workboard_entry_meta` overlay.
 * A priority change on an academic row is therefore visible inside Study Pulse too. That is
 * the existing, deliberate mapping (Study Pulse stays the source of truth for the fields it
 * owns), but it makes this the one inline Table edit that writes outside Workboard's tables.
 */
export async function setPriority(item: WorkItem, next: WorkPriority): Promise<Response> {
  return fetch(writeUrl(item), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority: next }),
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

/** The meta line's color, keyed by the same `DueState` that produced its text — so the two can
 *  never contradict each other. (They used to: the colour was computed from a bare
 *  `due < todayStr` with no status check, which painted a completed-early item's "Completed"
 *  label in the overdue alert red.) `Record<DueState, …>` means a new state cannot be added
 *  without deciding its colour here.
 *  `#922e48` is §6's overdue alert red; `#8a5010` is §2a's darkened amber, the only
 *  AA-passing amber text colour in this system (§8 forbids the raw `#f0a35c` behind text);
 *  `#5c6b80` is §1's ordinary meta-text colour. */
const META_COLOR: Record<DueState, string> = {
  none:           '#5c6b80',
  upcoming:       '#5c6b80',
  due_today:      '#5c6b80',
  completed:      '#5c6b80',
  completed_late: '#8a5010',
  overdue:        '#922e48',
};

/** The row's single meta string — due label + estimate, joined by " · " — and the colour it
 *  renders in. Computed once and reused by both the desktop (meta line under the title) and
 *  mobile (meta folded into line 2) layouts so the two never disagree about what the row is
 *  telling the user. The label itself comes from `dueSemantics`, the module that owns due
 *  wording for every Workboard surface — this file deliberately keeps no second copy. */
function buildMeta(item: WorkItem, todayStr: string): { text: string | null; color: string } {
  const dueLabel = formatDueLabel(item, todayStr);
  const estimateLabel = item.estimated_hours !== null ? `${item.estimated_hours}h` : null;
  const parts = [dueLabel, estimateLabel].filter((p): p is string => p !== null);
  return {
    text: parts.length ? parts.join(' · ') : null,
    color: META_COLOR[dueStateOf(item, todayStr)],
  };
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
  /** Opens the create/edit dialog (Task 13) in edit mode for this item. */
  onEdit:     (item: WorkItem) => void;
}

export default function WorkItemRow({ item, todayStr, isDesktop, isLast, onChanged, onEdit }: WorkItemRowProps) {
  const [pending, setPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const meta = buildMeta(item, todayStr);
  const edgeColor = EDGE_COLOR[item.priority];
  const divider = isLast ? 'none' : '1px solid rgba(200,210,230,0.35)';

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const isDone = item.work_status === 'done';

  const handleToggle = async () => {
    if (pending) return;
    setPending(true);
    try {
      // List never shows done items (groupByTimeframe excludes them), so here the toggle is
      // always todo/in_progress -> done. But this row is shared with Board (Task 15), whose
      // Done column shows completed items and must let the user un-complete one — hence the
      // real toggle rather than a hardcoded 'done', even though List only ever exercises one
      // branch of it today.
      const next: WorkStatus = isDone ? 'todo' : 'done';
      const res = await setWorkStatus(item, next);
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
        checked={isDone}
        disabled={pending}
        onChange={handleToggle}
        aria-label={isDone ? `Mark "${item.title}" as not done` : `Mark "${item.title}" as done`}
        style={{ width: '20px', height: '20px', cursor: pending ? 'default' : 'pointer', accentColor: '#256f92' }}
      />
    </label>
  );

  // Rendered per the direction doc's §3 row structure (6 of 6 elements). Task 13 wires this
  // up to a single "Edit" action opening the create/edit dialog; Task 15's Board is expected
  // to add a "Move to →" submenu alongside it rather than building a second trigger.
  const overflowButton = (
    <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        className="vb-row-overflow"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="More options"
        onClick={() => setMenuOpen(o => !o)}
        style={{
          width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', borderRadius: '8px', color: '#5c6b80',
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <MoreVertical size={16} />
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="vb-row-menu"
          style={{
            position: 'absolute', right: 0, top: '36px', zIndex: 20, minWidth: '120px',
            background: '#fff', borderRadius: '10px', border: '1px solid rgba(200,210,230,0.6)',
            boxShadow: '0 8px 24px rgba(31,38,68,0.18)', padding: '4px', overflow: 'hidden',
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="vb-row-menu-item"
            onClick={() => { setMenuOpen(false); onEdit(item); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
              background: 'transparent', border: 'none', borderRadius: '6px', cursor: 'pointer',
              fontFamily: FONT, fontSize: '0.82rem', fontWeight: 600, color: '#2d3748',
            }}
          >
            Edit
          </button>
        </div>
      )}
    </div>
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
                fontFamily: FONT, fontSize: '0.88rem', fontWeight: 600,
                color: isDone ? '#9aa4b5' : '#2d3748', textDecoration: isDone ? 'line-through' : 'none',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {item.title}
            </span>
            {meta.text && (
              <span style={{ fontFamily: FONT, fontSize: '0.76rem', fontWeight: 500, color: meta.color }}>
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
                color: isDone ? '#9aa4b5' : '#2d3748', textDecoration: isDone ? 'line-through' : 'none',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {item.title}
            </span>
            {item.priority === 'high' && <span style={{ marginLeft: '8px' }}><HighPriorityPill /></span>}
            <div style={{ marginLeft: 'auto', paddingLeft: '8px' }}>{overflowButton}</div>
          </div>

          <div style={{ marginLeft: '52px', marginTop: '6px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
            <CategoryChip category={item.category} />
            {item.chip_label && <ProjectChip label={item.chip_label} />}
            {meta.text && (
              <span style={{ fontFamily: FONT, fontSize: '0.76rem', fontWeight: 500, color: meta.color }}>
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
        .vb-row-overflow:hover:not(:disabled) { background: rgba(200,210,230,0.3); }
        .vb-row-menu-item:hover { background: rgba(116,188,217,0.12); }
        .vb-row-menu-item:focus-visible { outline: 2px solid #2a7fa8; outline-offset: -2px; }
      `}</style>
    </div>
  );
}
