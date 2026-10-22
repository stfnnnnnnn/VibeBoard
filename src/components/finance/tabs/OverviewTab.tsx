'use client';

import WbSkeleton from '@/components/workboard/ui/WbSkeleton';
import { addDays } from '@/lib/finance/dates';
import { groupByDay, type FeedItem } from '@/lib/finance/feed';
import DayFeed, { feedKey } from '../feed/DayFeed';
import UpcomingList, { plannedKey } from '../feed/UpcomingList';
import type { TransactionItem } from '../types';

const RECENT_LIMIT = 8;

/* Spec §6 + Addendum A: Recent (the latest 8 entries, grouped by day, so each day's net covers
   only the rows shown) and Coming up (next 3 planned). The composer sits above this tab,
   rendered by the shell. */
export default function OverviewTab({ recent, upcoming, today, hidden, freshKey, onDelete, onDeletePlanned, onSeeAll }: {
  recent: FeedItem[] | null; upcoming: TransactionItem[] | null; today: string; hidden: Set<string>;
  freshKey: string | null; onDelete: (item: FeedItem) => void; onDeletePlanned: (item: TransactionItem) => void; onSeeAll: () => void;
}) {
  if (recent === null) {
    return <div className="fin-card">{[0, 1, 2, 3].map(i => <WbSkeleton key={i} height={40} radius={8} style={{ marginBottom: 10 }} />)}</div>;
  }
  const visible = recent.filter(i => !hidden.has(feedKey(i)));
  const shown = visible.slice(0, RECENT_LIMIT);
  const soon = (upcoming ?? []).filter(i => i.entry_date <= addDays(today, 14) && !hidden.has(plannedKey(i)));
  if (visible.length === 0 && soon.length === 0) {
    return <div className="fin-card fin-empty"><p>Log your first expense to see your pace.</p></div>;
  }
  return (
    <>
      <section className="fin-card" aria-labelledby="fin-recent-title">
        <div className="fin-card__head">
          <h2 className="fin-card__title" id="fin-recent-title">Recent</h2>
          <button type="button" className="fin-link fin-push" onClick={onSeeAll}>All activity →</button>
        </div>
        {shown.length ? <DayFeed groups={groupByDay(shown, today)} onDelete={onDelete} freshKey={freshKey} /> : <p className="fin-hint">Nothing logged yet.</p>}
        {visible.length > shown.length && (
          <div className="fin-recent-more">
            <span>Showing the latest {RECENT_LIMIT} entries</span>
            <button type="button" className="fin-link" onClick={onSeeAll}>All activity →</button>
          </div>
        )}
      </section>
      {soon.length > 0 && (
        <section className="fin-card" aria-labelledby="fin-soon-title">
          <div className="fin-card__head">
            <h2 className="fin-card__title" id="fin-soon-title">Coming up</h2>
            <button type="button" className="fin-link fin-push" onClick={onSeeAll}>All upcoming →</button>
          </div>
          <p className="fin-card__sub">Planned and recurring, next 14 days</p>
          <UpcomingList items={soon} today={today} limit={3} onDelete={onDeletePlanned} />
        </section>
      )}
    </>
  );
}
