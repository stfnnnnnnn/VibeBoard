'use client';

import { AlertTriangle } from 'lucide-react';
import type { WorkStats } from '@/lib/workboard/workStats';
import { OVERDUE_SECTION_ID } from './views/WorkListView';

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";
const HEADER_FONT = "'DM Sans','Segoe UI',sans-serif";

/** The shell's Focus/List view tab (`WorkboardShell.tsx` renders `vb-view-tab-${key}`). */
const LIST_VIEW_TAB_ID = 'vb-view-tab-list';

/**
 * Takes the user to the Overdue section: switches to the Focus view first if another view is
 * showing, then scrolls the section into view.
 *
 * The hop goes through the DOM rather than a callback prop because the card and the section
 * have no common owner that passes state between them — the shell holds `view`, but this
 * card is rendered above the view switcher and the section lives two components below it.
 * Clicking the tab button drives the shell's own `setView`, so the switch stays one code
 * path rather than a second source of truth for which view is active.
 */
function goToOverdueSection() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scroll = (el: Element) =>
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });

  const existing = document.getElementById(OVERDUE_SECTION_ID);
  if (existing) { scroll(existing); return; }

  // Not mounted: another view is showing (or Focus is showing but a category/search filter
  // has hidden every overdue item, in which case there is simply nothing to scroll to).
  document.getElementById(LIST_VIEW_TAB_ID)?.click();
  // Two frames: one for React to commit the view switch, one for layout to settle before
  // the scroll target's position is read.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const section = document.getElementById(OVERDUE_SECTION_ID);
    if (section) scroll(section);
  }));
}

/** Neutral card treatment shared by Active, Due Soon, Estimated This Week, and Overdue at
 *  zero — direction doc §6: the sameness at zero is what makes the alert state at non-zero
 *  actually register as a change. */
const NEUTRAL_CARD: React.CSSProperties = {
  background: 'rgba(255,255,255,0.4)',
  border: '1px solid rgba(255,255,255,0.4)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  borderRadius: '18px',
  padding: '16px 18px',
  flex: '1 1 0',
  minWidth: 0,
  boxSizing: 'border-box',
};

/** §6's Overdue-alert treatment: five co-occurring, non-animated changes (background,
 *  border, numeral color, icon, edge) rather than a color swap alone. */
const ALERT_CARD: React.CSSProperties = {
  ...NEUTRAL_CARD,
  background: 'rgba(224,96,124,0.14)',
  border: '1px solid rgba(224,96,124,0.35)',
  position: 'relative',
};

/**
 * `onActivate` turns the card into a real `<button>`; omitting it leaves an ordinary `<div>`.
 * That is the whole mechanism behind "the Overdue card is inert at zero": at zero it is not a
 * disabled-looking button, it is not a button — no pointer cursor, no focus stop, no
 * accessible name change, nothing for a keyboard user to land on and discover does nothing.
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
  const base = alert ? ALERT_CARD : NEUTRAL_CARD;
  const edge = alert && (
    <span
      aria-hidden
      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', background: '#e0607c', borderRadius: '18px 0 0 18px' }}
    />
  );

  if (!onActivate) {
    return <div style={base}>{edge}{children}</div>;
  }

  return (
    <button
      type="button"
      className="vb-stat-card-btn"
      onClick={onActivate}
      title={activateTitle}
      style={{
        ...base,
        // `position` is only on ALERT_CARD; the button needs it either way so the edge stripe
        // and the focus ring's border-radius have something to anchor to.
        position: 'relative',
        display: 'block', width: '100%', textAlign: 'left', font: 'inherit', cursor: 'pointer',
      }}
    >
      {edge}
      {children}
      {/* The focus ring and the hover cue can only be expressed as pseudo-classes, so they
          live in `<style jsx>` rather than inline — the pattern the rest of this module
          already uses. `:focus-visible`, never bare `:focus`, per direction doc §9. The block
          sits inside `Card` rather than beside the grid's stylesheet below because styled-jsx
          scopes its rules to the elements of the component that renders them, and this button
          is rendered here. */}
      <style jsx>{`
        .vb-stat-card-btn {
          transition: border-color 150ms ease;
        }
        .vb-stat-card-btn:hover {
          border-color: rgba(224,96,124,0.6);
        }
        .vb-stat-card-btn:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .vb-stat-card-btn { transition: none; }
        }
      `}</style>
    </button>
  );
}

function Label({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '5px', fontFamily: FONT, fontSize: '0.74rem',
      fontWeight: 700, color: alert ? '#922e48' : '#5c6b80', marginBottom: '4px',
    }}>
      {alert && <AlertTriangle size={14} color="#922e48" aria-hidden />}
      {children}
    </div>
  );
}

function Numeral({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div style={{
      fontFamily: HEADER_FONT, fontSize: '1.7rem', fontWeight: 800,
      color: alert ? '#922e48' : '#2d3748', fontVariantNumeric: 'tabular-nums', lineHeight: 1.15,
    }}>
      {children}
    </div>
  );
}

function Subtitle({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div style={{ fontFamily: FONT, fontSize: '0.7rem', fontWeight: 600, color: alert ? '#a0405a' : '#8a94a6', marginTop: '2px' }}>
      {children}
    </div>
  );
}

/** Formats "oldest from <date>" for the overdue subtitle. `oldestDue` is "YYYY-MM-DD". */
function formatOldest(oldestDue: string): string {
  const d = new Date(`${oldestDue}T00:00:00Z`);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `oldest from ${month} ${d.getUTCDate()}`;
}

export interface WorkboardStatsProps {
  stats: WorkStats;
  /** "YYYY-MM-DD" of the earliest overdue item's due date, if any — used only for the
   *  Overdue card's subtitle ("3 past due — oldest from Sep 2"). Optional: when omitted or
   *  there are no overdue items, the subtitle omits the "oldest from" clause. */
  oldestOverdueDue?: string | null;
}

export default function WorkboardStats({ stats, oldestOverdueDue }: WorkboardStatsProps) {
  const {
    active_count, active_net_change_7d, due_soon_count, overdue_count,
    estimated_hours_this_week, estimated_items_counted, estimated_items_missing,
  } = stats;

  const overdueAlert = overdue_count > 0;
  const completed7d = Math.max(0, -active_net_change_7d);

  const estimatedItemsTotal = estimated_items_counted + estimated_items_missing;
  const estimateSubtitle = estimatedItemsTotal === 0
    ? 'No items due this week'
    : estimated_items_missing > 0
      ? `across ${estimatedItemsTotal} item${estimatedItemsTotal === 1 ? '' : 's'} · ${estimated_items_missing} without an estimate`
      : `across ${estimatedItemsTotal} item${estimatedItemsTotal === 1 ? '' : 's'}`;

  const overdueSubtitle = overdueAlert
    ? `${overdue_count} past due${oldestOverdueDue ? ` — ${formatOldest(oldestOverdueDue)}` : ''}`
    : 'All caught up';

  return (
    <div className="vb-stat-grid" style={{ display: 'grid', gap: '14px', marginBottom: '22px' }}>
      <Card>
        <Label>Active</Label>
        <Numeral>{active_count}</Numeral>
        <Subtitle>{completed7d} completed in the last 7 days</Subtitle>
      </Card>

      <Card>
        <Label>Due Soon</Label>
        <Numeral>{due_soon_count}</Numeral>
        <Subtitle>Within the next 3 days</Subtitle>
      </Card>

      <Card>
        <Label>Estimated This Week</Label>
        <Numeral>{estimated_hours_this_week}h</Numeral>
        <Subtitle>{estimateSubtitle}</Subtitle>
      </Card>

      {/* Interactive only when there is something to jump to (§6's zero state is inert, and
          a card that scrolls to a section that isn't rendered would be a dead control). */}
      <Card
        alert={overdueAlert}
        onActivate={overdueAlert ? goToOverdueSection : undefined}
        activateTitle={overdueAlert ? 'Show the Overdue section' : undefined}
      >
        <Label alert={overdueAlert}>Overdue</Label>
        <Numeral alert={overdueAlert}>{overdue_count}</Numeral>
        <Subtitle alert={overdueAlert}>{overdueSubtitle}</Subtitle>
      </Card>

      {/* Direction doc §10: 4-in-a-row at >=1024px, 2x2 grid below it (tablet and mobile
          share the same 2x2 treatment). `grid-template-columns` is kept out of the inline
          style above and set only here, in the stylesheet, so this media query can override
          it — an inline declaration of the same property would always win over a plain class
          rule regardless of the media query, per ordinary CSS specificity. */}
      <style jsx>{`
        .vb-stat-grid { grid-template-columns: repeat(4, 1fr); }
        @media (max-width: 1023px) {
          .vb-stat-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  );
}
