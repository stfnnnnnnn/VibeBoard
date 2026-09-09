'use client';

import { BarChart3, CalendarClock } from 'lucide-react';
// Type-only imports from `workItems.ts` — that module imports `pool` (mysql2) at module
// scope for its DB-access exports, so a runtime import here would drag mysql2 into this
// client bundle (see WorkboardShell.tsx's and WorkItemRow.tsx's comments on the same hazard).
import type { WorkItem } from '@/lib/workboard/workItems';
import type { WorkloadDay } from '@/lib/workboard/workStats';
import { WORK_CATEGORIES, type WorkCategory } from '@/lib/workboard/workCategories';
import { dueDateOf } from '@/lib/workboard/dates';
// The single source of due-label truth. It is pool-free — it imports only `dates.ts`,
// which has no imports at all, plus a type-only `WorkItem` that erases at compile time.
import { formatDueLabel } from '@/lib/workboard/dueSemantics';

/** Direction doc §11/§12: the shell's outer-panel and rail-panel glass treatment, matched
 *  to `WorkboardWeekView.tsx`'s `GLASS` constant exactly rather than reinvented. */
const GLASS: React.CSSProperties = {
  background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
  borderRadius: '22px', border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 8px 24px rgba(31,38,68,0.09)',
};

const FONT    = "'Inter','DM Sans','Segoe UI',sans-serif";
const DM_FONT = "'DM Sans','Segoe UI',sans-serif";

/** §2a's raw category hues — non-text decoration (chart segments, dots), never chip text.
 *  Same four values as `WorkItemRow.tsx`'s `CATEGORY_META` source-hue column. */
const CATEGORY_HUE: Record<WorkCategory, string> = {
  academic:     '#4dabf5',
  project:      '#8b7fd6',
  organization: '#f0a35c',
  life:         '#f2a7c0',
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CHART_HEIGHT = 64; // px, the tallest bar's height when a day equals the week's max

function PanelHeader({ Icon, children }: { Icon: typeof BarChart3; children: React.ReactNode }) {
  return (
    <h3 style={{
      margin: '0 0 10px', fontFamily: DM_FONT, fontSize: '0.95rem', fontWeight: 800,
      color: '#2d3748', display: 'flex', alignItems: 'center', gap: '6px',
    }}>
      <Icon size={16} color="#74bcd9" /> {children}
    </h3>
  );
}

function WorkloadChart({ workload }: { workload: WorkloadDay[] }) {
  const weekTotal = workload.reduce((sum, d) => sum + d.total, 0);

  if (weekTotal === 0) {
    return (
      <p style={{
        margin: 0, padding: '24px 0', textAlign: 'center',
        fontFamily: FONT, fontSize: '0.78rem', fontWeight: 600, color: '#5c6b80',
      }}>
        No workload this week
      </p>
    );
  }

  const weekMax = Math.max(...workload.map(d => d.total));
  const heaviestIndex = workload.findIndex(d => d.total === weekMax);

  return (
    <div>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', height: `${CHART_HEIGHT + 16}px` }}>
        {workload.map((day, i) => {
          const barHeight = weekMax > 0 ? Math.round((day.total / weekMax) * CHART_HEIGHT) : 0;
          return (
            <div
              key={day.date}
              style={{
                flex: '1 1 0', height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'flex-end',
              }}
            >
              {i === heaviestIndex && (
                <span style={{
                  fontFamily: DM_FONT, fontSize: '0.62rem', fontWeight: 800, color: '#5c6b80',
                  marginBottom: '2px',
                }}>
                  {day.total}
                </span>
              )}
              <div
                title={`${day.date}: ${day.total} due`}
                style={{
                  width: '100%', height: `${barHeight}px`, borderRadius: '3px 3px 0 0',
                  overflow: 'hidden', display: 'flex', flexDirection: 'column-reverse',
                  background: barHeight === 0 ? 'rgba(200,210,230,0.35)' : 'transparent',
                }}
              >
                {WORK_CATEGORIES.map(cat => {
                  const count = day[cat];
                  if (count === 0 || day.total === 0) return null;
                  const segHeight = Math.round((count / day.total) * barHeight);
                  return <div key={cat} style={{ width: '100%', height: `${segHeight}px`, background: CATEGORY_HUE[cat] }} />;
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        {DAY_LABELS.map(label => (
          <span key={label} style={{
            flex: '1 1 0', textAlign: 'center', fontFamily: DM_FONT, fontSize: '0.68rem',
            fontWeight: 800, textTransform: 'uppercase', color: '#8a94a6',
          }}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function UpcomingDeadlines({ items, todayStr }: { items: WorkItem[]; todayStr: string }) {
  const deadlines = items
    .filter(item => item.work_status !== 'done' && dueDateOf(item) !== null)
    .sort((a, b) => dueDateOf(a)!.localeCompare(dueDateOf(b)!))
    .slice(0, 6);

  if (deadlines.length === 0) {
    return (
      <p style={{
        margin: 0, padding: '20px 0', textAlign: 'center',
        fontFamily: FONT, fontSize: '0.78rem', fontWeight: 600, color: '#5c6b80',
      }}>
        No upcoming deadlines
      </p>
    );
  }

  return (
    <div style={{ overflowY: 'auto', maxHeight: '240px' }}>
      {deadlines.map((item, i) => (
        <div
          key={`${item.source}-${item.id}`}
          title={item.title}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 0',
            borderBottom: i === deadlines.length - 1 ? 'none' : '1px solid rgba(200,210,230,0.3)',
          }}
        >
          <span aria-hidden style={{
            width: '4px', height: '4px', borderRadius: '50%', flexShrink: 0,
            background: CATEGORY_HUE[item.category],
          }} />
          <span style={{
            flex: '1 1 auto', minWidth: 0, fontFamily: FONT, fontSize: '0.8rem', fontWeight: 600,
            color: '#2d3748', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {item.title}
          </span>
          <span style={{
            flexShrink: 0, fontFamily: FONT, fontSize: '0.7rem', fontWeight: 600, color: '#5c6b80',
          }}>
            {formatDueLabel(item, todayStr)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Direction doc §12: the right rail — two independently-scrolling glass panels (workload
 * chart, upcoming deadlines), shown beside List/Calendar and collapsed on Board/Timeline
 * (WorkboardShell.tsx decides *when* to render this; this component only renders its own
 * two panels). Always reads whole-board `work.workload`/`work.items` — never the shell's
 * filtered `visibleItems` — so the rail's numbers don't move as the user searches or
 * switches category tabs, same rule the stat cards (WorkboardStats.tsx) follow.
 */
export default function WorkboardRail({ workload, items, todayStr }: {
  workload: WorkloadDay[];
  items: WorkItem[];
  todayStr: string;
}) {
  return (
    <div className="vb-rail" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ ...GLASS, padding: '14px' }}>
        <PanelHeader Icon={BarChart3}>This Week&apos;s Workload</PanelHeader>
        <WorkloadChart workload={workload} />
      </div>
      <div style={{ ...GLASS, padding: '14px' }}>
        <PanelHeader Icon={CalendarClock}>Upcoming Deadlines</PanelHeader>
        <UpcomingDeadlines items={items} todayStr={todayStr} />
      </div>

      {/* Direction doc §10: the rail is a fixed 240px column beside content at >=1024px, and
          moves below the main content (full width, natural height) from 1023px down — `flex`
          is kept out of this root's inline style (see WorkBoardView.tsx's column-width comment
          for why an inline value here would make this media query inert) so this override can
          actually take effect once the shell stacks the row into a column below 1024px. */}
      <style jsx>{`
        .vb-rail { flex: 0 0 240px; }
        @media (max-width: 1023px) {
          .vb-rail { flex: 1 1 auto; width: 100%; }
        }
      `}</style>
    </div>
  );
}
