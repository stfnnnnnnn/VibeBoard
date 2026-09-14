'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, SearchX, AlertTriangle } from 'lucide-react';
import type { WorkItem } from '@/lib/workboard/workItems';
import WorkItemRow from '../WorkItemRow';
import { groupByTimeframe, type TimeframeGroups } from '@/lib/workboard/workStats';

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";
const HEADER_FONT = "'DM Sans','Segoe UI',sans-serif";

/** The Overdue section's anchor, targeted by the Overdue stat card (`WorkboardStats.tsx`).
 *  Exported so the two files agree on the string rather than each spelling it out. */
export const OVERDUE_SECTION_ID = 'vb-section-overdue';

type SectionKey = keyof TimeframeGroups;

interface SectionMeta {
  label: string;
  /** The inline note shown when this section is expanded but empty (direction doc §7).
   *  `null` means the section is omitted from the view entirely when it has no items —
   *  Overdue's case: a permanent "no overdue work" row is noise on the common path, where
   *  having nothing overdue is the expected state. */
  emptyText: string | null;
  /** `alert` gives the heading §6's restrained overdue red plus an AlertTriangle — text and
   *  icon only, deliberately no tinted surface: the section is a heading, not a stat card. */
  tone: 'neutral' | 'alert';
}

/**
 * Exhaustive by construction, and deliberately so. This was previously a hand-written array
 * of `{ key: SectionKey, … }`, which TypeScript does not require to cover every key — when
 * `TimeframeGroups` gained its `overdue` member, the new group compiled cleanly and simply
 * never rendered. As a `Record<SectionKey, …>`, a fifth `TimeframeGroups` member fails the
 * build here instead of silently disappearing from the view.
 *
 * Render order is `Object.keys` of this same object (string keys enumerate in insertion
 * order, per the language spec), so the order list cannot drift out of sync with the set of
 * sections either — there is only one list.
 */
const SECTIONS: Record<SectionKey, SectionMeta> = {
  overdue:  { label: 'Overdue',  emptyText: null,                 tone: 'alert'   },
  today:    { label: 'Today',    emptyText: 'Nothing due today',  tone: 'neutral' },
  upcoming: { label: 'Upcoming', emptyText: 'Nothing upcoming',   tone: 'neutral' },
  later:    { label: 'Later',    emptyText: 'Nothing later',      tone: 'neutral' },
};

const SECTION_ORDER = Object.keys(SECTIONS) as SectionKey[];

/** `>=1024px` renders the row's single-line layout; below that, the two-line layout
 *  (direction doc §10). Defaults to desktop so the server-rendered markup and the first
 *  client paint agree — the effect below only ever corrects this after mount. */
function useIsDesktopRow(): boolean {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isDesktop;
}

export interface WorkListViewProps {
  /** Already filtered by category and search — see `WorkboardShell`'s `visibleItems`. */
  items:      WorkItem[];
  /** "YYYY-MM-DD" — `work.generated_at`, so every row agrees on "today" regardless of filtering. */
  todayStr:   string;
  /** True when the shell's category tab or search query is currently narrowing `items` —
   *  distinguishes "genuinely nothing on the board" from "nothing matches this filter", which
   *  need different empty-state copy (the direction doc's "Nothing on your plate" state
   *  predates category/search filtering and assumes the former). */
  isFiltered?: boolean;
  onChanged:  () => void | Promise<void>;
  /** Opens the create/edit dialog (Task 13) in edit mode for a given item. */
  onEdit:     (item: WorkItem) => void;
  /** Opens the detail drawer (Task 32) for a given item — passed straight through to each row,
   *  whose title is the trigger. Complementary to `onEdit`, not a replacement: the row's overflow
   *  menu still opens the edit dialog. */
  onOpenDetail: (item: WorkItem) => void;
  /** Opens the create/edit dialog in create mode — wired to this view's own empty-state button. */
  onNewItem:  () => void;
}

export default function WorkListView({ items: allItems, todayStr, isFiltered, onChanged, onEdit, onOpenDetail, onNewItem }: WorkListViewProps) {
  const groups = useMemo(
    () => groupByTimeframe(allItems, todayStr),
    [allItems, todayStr],
  );
  const [collapsed, setCollapsed] = useState<Partial<Record<SectionKey, boolean>>>({});
  const isDesktop = useIsDesktopRow();

  // Summed over every section rather than a hand-listed subset: an all-overdue board used to
  // total zero here and render the "Nothing on your plate" empty state — the exact inverse of
  // the truth. Driving this off `SECTION_ORDER` means a new group counts automatically.
  const totalOpen = SECTION_ORDER.reduce((n, key) => n + groups[key].length, 0);

  /** Sections that render at all: one whose `emptyText` is `null` (Overdue) disappears when
   *  empty rather than showing a note. Computed before the map so the first *visible* section
   *  is the one that gets no top margin. */
  const visibleSections = SECTION_ORDER.filter(
    key => groups[key].length > 0 || SECTIONS[key].emptyText !== null,
  );

  if (totalOpen === 0 && isFiltered) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <SearchX size={48} color="#9aa4b5" style={{ marginBottom: '14px' }} />
        <h2 style={{ fontFamily: HEADER_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
          No matching work items
        </h2>
        <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: 0 }}>
          Try a different category, search term, or filter.
        </p>
      </div>
    );
  }

  if (totalOpen === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <CheckCircle2 size={56} color="#74bcd9" style={{ marginBottom: '14px' }} />
        <h2 style={{ fontFamily: HEADER_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
          Nothing on your plate
        </h2>
        <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: '0 0 18px' }}>
          Add your first work item to get started.
        </p>
        <button type="button" className="vb-btn-pink" onClick={onNewItem} style={{ width: 'auto', padding: '10px 22px' }}>
          New Item
        </button>
      </div>
    );
  }

  return (
    <div>
      {visibleSections.map((key, idx) => {
        const section = SECTIONS[key];
        const items = groups[key];
        const isCollapsed = collapsed[key] ?? false;
        const isAlert = section.tone === 'alert';
        // §6/§8: `#922e48` is the approved alert *text* red and `#a0405a` its subdued
        // companion — the restrained accent, not a saturated surface. The heading keeps the
        // same background as every other section.
        const headingColor = isAlert ? '#922e48' : '#2d3748';
        const countColor   = isAlert ? '#a0405a' : '#8a94a6';

        return (
          <div
            key={key}
            id={key === 'overdue' ? OVERDUE_SECTION_ID : undefined}
            style={{ marginTop: idx === 0 ? 0 : '20px', scrollMarginTop: '16px' }}
          >
            <button
              type="button"
              className="vb-section-toggle"
              onClick={() => setCollapsed(c => ({ ...c, [key]: !isCollapsed }))}
              aria-expanded={!isCollapsed}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent',
                border: 'none', cursor: 'pointer', padding: '2px', marginBottom: '8px', borderRadius: '6px',
              }}
            >
              {isCollapsed ? <ChevronRight size={16} color={headingColor} /> : <ChevronDown size={16} color={headingColor} />}
              {isAlert && <AlertTriangle size={15} color="#922e48" aria-hidden />}
              <span style={{ fontFamily: HEADER_FONT, fontSize: '0.95rem', fontWeight: 800, color: headingColor }}>
                {section.label}
              </span>
              <span style={{ fontFamily: FONT, fontSize: '0.78rem', fontWeight: 700, color: countColor }}>
                · {items.length}
              </span>
            </button>

            {!isCollapsed && (
              items.length === 0 ? (
                <p style={{ fontFamily: FONT, fontStyle: 'italic', color: '#5c6b80', fontSize: '0.82rem', padding: '14px 4px', margin: 0 }}>
                  {section.emptyText}
                </p>
              ) : (
                <div>
                  {items.map((item, i) => (
                    <WorkItemRow
                      key={`${item.source}-${item.id}`}
                      item={item}
                      todayStr={todayStr}
                      isDesktop={isDesktop}
                      isLast={i === items.length - 1}
                      onChanged={onChanged}
                      onEdit={onEdit}
                      onOpenDetail={onOpenDetail}
                    />
                  ))}
                </div>
              )
            )}
          </div>
        );
      })}

      <style jsx>{`
        .vb-section-toggle:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
