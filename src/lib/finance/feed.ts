// src/lib/finance/feed.ts
/* Day-grouped feed (spec §9.2) and the period comparison wording carried over from the
   retired Activity Breakdown card (spec §9.1). */
import { formatDay, formatWeekdayDate, addDays } from './dates';

export interface FeedItem { id: number; type: 'allowance' | 'expense' | 'savings'; entry_date: string; amount: number; label: string; goal_id: number | null; recurring: boolean }
export interface DayGroup { date: string; title: string; subtitle: string; inflow: number; spent: number; saved: number; items: FeedItem[] }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function groupByDay(items: FeedItem[], today: string): DayGroup[] {
  const byDate = new Map<string, FeedItem[]>();
  for (const item of items) {
    const list = byDate.get(item.entry_date) ?? [];
    list.push(item);
    byDate.set(item.entry_date, list);
  }
  return [...byDate.keys()].sort().reverse().map(date => {
    const list = byDate.get(date)!;
    const sum = (t: FeedItem['type']) => r2(list.filter(i => i.type === t).reduce((s, i) => s + i.amount, 0));
    const relative = date === today || date === addDays(today, -1);
    return {
      date,
      title: formatDay(date, today),
      // "Today"/"Yesterday" get the calendar date beside them; older days already show it as the title.
      subtitle: relative ? formatWeekdayDate(date) : '',
      inflow: sum('allowance'),
      spent: sum('expense'),
      saved: sum('savings'),
      items: list,
    };
  });
}

export function compareText(current: number, previous: number | null, range: 'week' | 'month' | 'all'): { text: string; tone: 'up' | 'down' | 'muted' } {
  if (range === 'all') return { text: 'No prior period to compare', tone: 'muted' };
  const word = range === 'week' ? 'week' : 'month';
  if (previous === null || previous <= 0) return { text: `No data last ${word}`, tone: 'muted' };
  const delta = ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 0.5) return { text: `≈ same as last ${word}`, tone: 'muted' };
  /* A tiny previous period makes the percentage absurd (₱20 → ₱5,000 is "▲ 24900%"), so from
     10× up it reads as a multiple, capped at "over 100×". */
  if (delta >= 900) {
    const times = current / previous;
    return { text: times >= 100 ? `▲ over 100× vs last ${word}` : `▲ ${Math.round(times)}× vs last ${word}`, tone: 'up' };
  }
  return delta > 0
    ? { text: `▲ ${Math.round(delta)}% vs last ${word}`, tone: 'up' }
    : { text: `▼ ${Math.round(Math.abs(delta))}% vs last ${word}`, tone: 'down' };
}
