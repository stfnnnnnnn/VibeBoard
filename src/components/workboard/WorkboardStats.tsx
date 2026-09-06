import { AlertTriangle } from 'lucide-react';
import type { WorkStats } from '@/lib/workboard/workStats';

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";
const HEADER_FONT = "'DM Sans','Segoe UI',sans-serif";

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

function Card({
  children, alert,
}: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div style={alert ? ALERT_CARD : NEUTRAL_CARD}>
      {alert && (
        <span
          aria-hidden
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', background: '#e0607c', borderRadius: '18px 0 0 18px' }}
        />
      )}
      {children}
    </div>
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
    <div style={{ display: 'flex', gap: '14px', marginBottom: '22px', flexWrap: 'wrap' }}>
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

      <Card alert={overdueAlert}>
        <Label alert={overdueAlert}>Overdue</Label>
        <Numeral alert={overdueAlert}>{overdue_count}</Numeral>
        <Subtitle alert={overdueAlert}>{overdueSubtitle}</Subtitle>
      </Card>
    </div>
  );
}
