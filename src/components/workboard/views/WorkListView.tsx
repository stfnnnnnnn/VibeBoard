'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, SearchX } from 'lucide-react';
import type { WorkItem } from '@/lib/workboard/workItems';
import WorkItemRow from '../WorkItemRow';
import { groupByTimeframe, type TimeframeGroups } from '@/lib/workboard/workStats';

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";
const HEADER_FONT = "'DM Sans','Segoe UI',sans-serif";

type SectionKey = keyof TimeframeGroups;

const SECTIONS: { key: SectionKey; label: string; emptyText: string }[] = [
  { key: 'today',    label: 'Today',    emptyText: 'Nothing due today' },
  { key: 'upcoming', label: 'Upcoming', emptyText: 'Nothing upcoming' },
  { key: 'later',    label: 'Later',    emptyText: 'Nothing later' },
];

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
}

export default function WorkListView({ items: allItems, todayStr, isFiltered, onChanged }: WorkListViewProps) {
  const groups = useMemo(
    () => groupByTimeframe(allItems, todayStr),
    [allItems, todayStr],
  );
  const [collapsed, setCollapsed] = useState<Partial<Record<SectionKey, boolean>>>({});
  const isDesktop = useIsDesktopRow();

  const totalOpen = groups.today.length + groups.upcoming.length + groups.later.length;

  if (totalOpen === 0 && isFiltered) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <SearchX size={48} color="#9aa4b5" style={{ marginBottom: '14px' }} />
        <h2 style={{ fontFamily: HEADER_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
          No matching work items
        </h2>
        <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: 0 }}>
          Try a different category or search term.
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
        {/* No add-item entry point exists in the shell yet (Task 11 only builds List) —
            this button is rendered per the direction doc's spec, ready for that flow to
            attach an onClick once it exists. `disabled` until then: this is the only
            control a brand-new user sees on first run, so it must not look interactive
            while it does nothing. */}
        <button type="button" className="vb-btn-pink" disabled style={{ width: 'auto', padding: '10px 22px' }}>
          New Work Item
        </button>
      </div>
    );
  }

  return (
    <div>
      {SECTIONS.map((section, idx) => {
        const items = groups[section.key];
        const isCollapsed = collapsed[section.key] ?? false;

        return (
          <div key={section.key} style={{ marginTop: idx === 0 ? 0 : '20px' }}>
            <button
              type="button"
              className="vb-section-toggle"
              onClick={() => setCollapsed(c => ({ ...c, [section.key]: !isCollapsed }))}
              aria-expanded={!isCollapsed}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent',
                border: 'none', cursor: 'pointer', padding: '2px', marginBottom: '8px', borderRadius: '6px',
              }}
            >
              {isCollapsed ? <ChevronRight size={16} color="#2d3748" /> : <ChevronDown size={16} color="#2d3748" />}
              <span style={{ fontFamily: HEADER_FONT, fontSize: '0.95rem', fontWeight: 800, color: '#2d3748' }}>
                {section.label}
              </span>
              <span style={{ fontFamily: FONT, fontSize: '0.78rem', fontWeight: 700, color: '#8a94a6' }}>
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
