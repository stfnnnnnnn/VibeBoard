'use client';

import { useId, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { WorkStats } from '@/lib/workboard/workStats';
import type { WorkItem } from '@/lib/workboard/workItems';
import { addDays } from '@/lib/workboard/dates';
import { weekCompletion, dueSoonByDay, estimateByDay } from '@/lib/workboard/ui/kpiSeries';
import { ProgressBar, DueDots, Sparkline } from './ui/KpiVisuals';
import { SHOW_UP_NEXT_EVENT, UP_NEXT_ID } from './views/WorkListView';

/** The shell's Focus/List view tab (`WorkboardShell.tsx` renders `vb-view-tab-${key}`). */
const LIST_VIEW_TAB_ID = 'vb-view-tab-list';

/** How long the Up next card keeps `data-flash` after a jump (Task 8 styles the flash). */
const FLASH_MS = 900;
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Takes the user to Focus's Up next card (refine spec §4, ruling R6): switches to the Focus view
 * first if another view is showing, then scrolls the card into view and flags it for a brief
 * highlight.
 *
 * The hop goes through the DOM rather than a callback prop because the card and its target
 * have no common owner that passes state between them — the shell holds `view`, but this card
 * is rendered above the view switcher and the target lives inside the Focus view. Clicking the
 * tab button drives the shell's own `setView`, so the switch stays one code path.
 *
 * Every lookup is null-guarded: if the target is not rendered (a filter has hidden it), there
 * is simply nothing to scroll to.
 */
function goToUpNext() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveal = (el: HTMLElement) => {
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    if (flashTimer !== null) clearTimeout(flashTimer);
    el.setAttribute('data-flash', 'true');
    flashTimer = setTimeout(() => { el.removeAttribute('data-flash'); flashTimer = null; }, FLASH_MS);
  };

  const existing = document.getElementById(UP_NEXT_ID);
  if (existing) { reveal(existing); return; }

  // Focus is showing but a phone picker day has replaced Up next: ask it to close the day.
  window.dispatchEvent(new CustomEvent(SHOW_UP_NEXT_EVENT));
  document.getElementById(LIST_VIEW_TAB_ID)?.click();
  // Two frames: one for React to commit the day close or view switch, one for layout to
  // settle before the scroll target's position is read.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const target = document.getElementById(UP_NEXT_ID);
    if (target) reveal(target);
  }));
}

/** Surface, radius and padding live in `.wb-glass-item` and the `.vb-kpi-card` rules below
 *  (the phone strip overrides the padding and flex sizing, which an inline style would block). */
const CARD_BASE: React.CSSProperties = { borderRadius: '16px', boxSizing: 'border-box' };

/** Refine spec §4: Overdue above zero is the one tinted card in the row. */
const ALERT_SURFACE: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(255,235,242,.9), rgba(255,245,248,.8))',
  border: '1px solid rgba(217,79,134,.25)',
};

/**
 * `onActivate` turns the card into a real `<button>`; omitting it leaves an ordinary `<div>`.
 * That is the whole mechanism behind "the Overdue card is inert at zero": at zero it is not a
 * disabled-looking button, it is not a button — no pointer cursor, no focus stop, nothing for
 * a keyboard user to land on and discover does nothing.
 */
function Card({
  children, alert, onActivate, activateTitle,
}: {
  children: React.ReactNode;
  alert?: boolean;
  onActivate?: () => void;
  /** Tooltip for the interactive form — the card's own text supplies its accessible name. */
  activateTitle?: string;
}) {
  const style = alert ? { ...CARD_BASE, ...ALERT_SURFACE } : CARD_BASE;
  const hintId = useId();

  if (!onActivate) {
    return <div className="wb-glass-item vb-kpi-card" style={style}>{children}</div>;
  }

  return (
    <>
    <button
      type="button"
      className="wb-glass-item vb-kpi-card vb-stat-card-btn wb-pressable wb-focus-ring"
      onClick={onActivate}
      title={activateTitle}
      aria-describedby={activateTitle ? hintId : undefined}
      style={{
        ...style,
        // A stretched <button> centres its content vertically; a top-anchored column keeps the
        // label at the same y as the three <div> cards beside it.
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'stretch',
        width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer',
      }}
    >
      {children}
      {/* The hover cue is a pseudo-class, so it lives in styled-jsx inside `Card` (styled-jsx
          scopes rules to the component that renders them); no transition, since only
          transform/opacity may animate. */}
      <style jsx>{`
        @media (hover: hover) and (pointer: fine) {
          .vb-stat-card-btn:hover { box-shadow: var(--wb-glass-item-shadow-hover); }
        }
      `}</style>
    </button>
    {/* The tooltip as a description, so screen readers announce what the button does. */}
    {activateTitle && <span id={hintId} className="wb-sr-only">{activateTitle}</span>}
    </>
  );
}

function Label({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '5px',
      font: '800 var(--wb-fs-11) var(--wb-font-ui)', letterSpacing: '.05em', textTransform: 'uppercase',
      color: alert ? 'var(--wb-danger)' : 'var(--wb-text-muted)', marginBottom: '4px',
    }}>
      {alert && <AlertTriangle size={13} color="var(--wb-danger)" aria-hidden />}
      {children}
    </div>
  );
}

/** `zero` mutes the numeral only (refine spec §4); size and weight come from `.vb-kpi-num`. */
function Numeral({ children, alert, zero }: { children: React.ReactNode; alert?: boolean; zero?: boolean }) {
  return (
    <div
      className="vb-kpi-num"
      style={{ color: alert ? 'var(--wb-danger)' : zero ? 'var(--wb-text-zero)' : 'var(--wb-text)' }}
    >
      {children}
    </div>
  );
}

/** `title` keeps the full text reachable when the phone strip clamps it to one line. */
function Subtitle({ children, alert }: { children: string; alert?: boolean }) {
  return (
    <div className="vb-kpi-sub" title={children} style={{ font: '500 var(--wb-fs-12) var(--wb-font-ui)', color: alert ? 'var(--wb-danger)' : 'var(--wb-text-muted)', marginTop: '4px' }}>
      {children}
    </div>
  );
}

/** "Jul 7" for the overdue subtitle. `oldestDue` is "YYYY-MM-DD". */
function formatMonthDay(oldestDue: string): string {
  const d = new Date(`${oldestDue}T00:00:00Z`);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} ${d.getUTCDate()}`;
}

/** "Tue" etc. for the third Due Soon dot. Local-midnight parse, matching `addDays`'s output. */
function weekdayShort(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
}

/** Spacing between a numeral and the micro-visual under it. */
const VISUAL_WRAP: React.CSSProperties = { marginTop: '8px', minHeight: '26px', display: 'flex', alignItems: 'flex-end' };

export interface WorkboardStatsProps {
  stats: WorkStats;
  /** "YYYY-MM-DD" of the earliest overdue item's due date, if any — used only for the
   *  Overdue card's subtitle ("Oldest from Sep 2 · Review →"). */
  oldestOverdueDue: string | null;
  /** Whole-board items (`work.items`, never the filtered list) behind the micro-visuals. */
  items: WorkItem[];
  today: string;
  weekStart: string;
}

export default function WorkboardStats({ stats, oldestOverdueDue, items, today, weekStart }: WorkboardStatsProps) {
  const {
    active_count, in_progress_count, due_soon_count, overdue_count,
    estimated_hours_this_week, estimated_items_counted, estimated_items_missing,
  } = stats;

  const completion = useMemo(() => weekCompletion(items, weekStart), [items, weekStart]);
  const dueDots = useMemo(() => dueSoonByDay(items, today), [items, today]);
  const spark = useMemo(() => estimateByDay(items, weekStart), [items, weekStart]);
  const sparkLabel = useMemo(() => 'Estimated hours per day: ' + spark
    .map((h, i) => `${weekdayShort(addDays(weekStart, i))} ${Math.round(h * 10) / 10}h`)
    .join(', '), [spark, weekStart]);
  const todayIdx = useMemo(() => {
    for (let i = 0; i < 7; i++) if (addDays(weekStart, i) === today) return i;
    return null;
  }, [weekStart, today]);

  const overdueAlert = overdue_count > 0;

  const estimatedItemsTotal = estimated_items_counted + estimated_items_missing;
  const estimateSubtitle = estimatedItemsTotal === 0
    ? 'No estimates yet'
    : estimated_items_missing > 0
      ? `across ${estimatedItemsTotal} item${estimatedItemsTotal === 1 ? '' : 's'} · ${estimated_items_missing} without an estimate`
      : `across ${estimatedItemsTotal} item${estimatedItemsTotal === 1 ? '' : 's'}`;

  const overdueSubtitle = overdueAlert
    ? `${oldestOverdueDue ? `Oldest from ${formatMonthDay(oldestOverdueDue)} · ` : ''}Review →`
    : 'Nothing past due';

  const activeSubtitle = completion.total === 0
    ? `${in_progress_count} in progress`
    : `${completion.done} of ${completion.total} done this week`;

  return (
    <div className="vb-stat-grid">
      <Card>
        <Label>Active</Label>
        <Numeral zero={active_count === 0}>{active_count}</Numeral>
        <div className="vb-kpi-visual" style={VISUAL_WRAP}>
          <div style={{ width: '100%' }}>
            <ProgressBar
              value={completion.total ? completion.done / completion.total : 0}
              label={`${completion.done} of ${completion.total} due this week done`}
            />
          </div>
        </div>
        <Subtitle>{activeSubtitle}</Subtitle>
      </Card>

      <Card>
        <Label>Due Soon</Label>
        <Numeral zero={due_soon_count === 0}>{due_soon_count}</Numeral>
        <div className="vb-kpi-visual" style={VISUAL_WRAP}>
          <DueDots
            counts={dueDots}
            labels={['Today', 'Tmrw', weekdayShort(addDays(today, 2)), weekdayShort(addDays(today, 3))]}
          />
        </div>
        <Subtitle>{due_soon_count === 0 ? 'Nothing in the next 3 days' : 'Within the next 3 days'}</Subtitle>
      </Card>

      <Card>
        <Label>This week</Label>
        <Numeral zero={estimated_hours_this_week === 0}>{estimated_hours_this_week}h</Numeral>
        <div className="vb-kpi-visual" style={VISUAL_WRAP}>
          <Sparkline values={spark} todayIndex={todayIdx} label={sparkLabel} />
        </div>
        <Subtitle>{estimateSubtitle}</Subtitle>
      </Card>

      {/* Interactive only when there is something to jump to (the zero state is inert, and a
          card that scrolls to nothing would be a dead control). */}
      <Card
        alert={overdueAlert}
        onActivate={overdueAlert ? goToUpNext : undefined}
        activateTitle={overdueAlert ? 'Review overdue work' : undefined}
      >
        <Label alert={overdueAlert}>Overdue</Label>
        {overdueAlert ? (
          <Numeral alert>{overdue_count}</Numeral>
        ) : (
          // The numeral's line box, so the four cards' subtitles stay aligned.
          <div className="vb-kpi-num">
            <span style={{ font: '800 var(--wb-fs-20) var(--wb-font-head)', letterSpacing: 0, color: 'var(--wb-success)' }}>
              All clear
            </span>
          </div>
        )}
        <Subtitle alert={overdueAlert}>{overdueSubtitle}</Subtitle>
      </Card>

      {/* 4 across at >= 1024px, 2x2 on tablet, and a horizontal scroll-snap strip of compact
          cards on phone (refine spec §4). The card classes are set inside `Card`/`Numeral`, so
          they are reached through :global under this component's own scoped grid. */}
      <style jsx>{`
        .vb-stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 22px; }
        .vb-stat-grid > :global(.vb-kpi-card) { min-width: 0; padding: 14px 16px; }
        .vb-stat-grid :global(.vb-kpi-num) {
          font: 750 34px/1.1 var(--wb-font-head); letter-spacing: -0.02em; font-variant-numeric: tabular-nums;
        }
        @media (max-width: 1023px) {
          .vb-stat-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 767px) {
          .vb-stat-grid {
            display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x mandatory;
            /* Room for the cards' drop shadow, which the scroll container would otherwise clip. */
            padding: 2px 0 14px; margin-bottom: 8px;
            overscroll-behavior-x: contain; scrollbar-width: none; -webkit-overflow-scrolling: touch;
          }
          .vb-stat-grid::-webkit-scrollbar { display: none; }
          .vb-stat-grid > :global(.vb-kpi-card) { flex: 0 0 140px; scroll-snap-align: start; padding: 10px 12px; }
          .vb-stat-grid :global(.vb-kpi-num) { font-size: 24px; }
          .vb-stat-grid :global(.vb-kpi-visual) { display: none !important; }
          .vb-stat-grid :global(.vb-kpi-sub) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        }
      `}</style>
    </div>
  );
}
