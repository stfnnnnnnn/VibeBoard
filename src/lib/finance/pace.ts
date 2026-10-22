// src/lib/finance/pace.ts
/* The Pace hero's data (spec §5.3): one bar per day of the current cycle, against the
   current per-day budget. Used by the hero and by the What-if preview. */
import { addDays, daysBetween, formatShortDate } from './dates';

export interface DailySpend { date: string; amount: number }
export interface PaceBar { date: string; amount: number; future: boolean; isToday: boolean; over: boolean }
export interface PaceSeries { bars: PaceBar[]; perDay: number; avg: number; diff: number; dayNumber: number; max: number }

const MAX_DAYS = 31;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function paceStartFor(lastActualAllowance: string | null, today: string): string {
  if (!lastActualAllowance || daysBetween(lastActualAllowance, today) > MAX_DAYS) return addDays(today, -6);
  return lastActualAllowance;
}

export function paceSeries(
  input: { pace_start: string; horizon_end: string; daily_spend: DailySpend[]; per_day: number },
  today: string,
): PaceSeries {
  let end = input.horizon_end < today ? today : input.horizon_end;
  let start = input.pace_start > today ? today : input.pace_start;
  if (daysBetween(start, end) + 1 > MAX_DAYS) start = addDays(end, -(MAX_DAYS - 1));
  // The window must always contain today: if trimming pushed start past it, anchor on today.
  if (start > today) { start = today; end = addDays(today, MAX_DAYS - 1); }
  const byDate = new Map(input.daily_spend.map(d => [d.date, d.amount]));

  const bars: PaceBar[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const amount = byDate.get(d) ?? 0;
    const future = d > today;
    bars.push({ date: d, amount, future, isToday: d === today, over: !future && amount > input.per_day });
  }
  const past = bars.filter(b => !b.future);
  const avg = past.length ? r2(past.reduce((s, b) => s + b.amount, 0) / past.length) : 0;
  return {
    bars,
    perDay: input.per_day,
    avg,
    diff: r2(input.per_day - avg),
    dayNumber: Math.max(1, daysBetween(input.pace_start, today) + 1),
    max: Math.max(input.per_day * 1.6, ...bars.map(b => b.amount), 1),
  };
}

export function axisLabels(bars: PaceBar[]): (string | null)[] {
  const last = bars.length - 1;
  const todayIdx = bars.findIndex(b => b.isToday);
  const mid = Math.round(last / 2);
  return bars.map((b, i) => {
    if (b.isToday) return 'Today';
    if (i === 0 && todayIdx >= 0 && todayIdx < 3) return null;
    if (i === last && todayIdx >= 0 && last - todayIdx < 3) return null;
    if (i === 0 || i === last) return formatShortDate(b.date);
    if (i === mid && Math.abs(i - todayIdx) >= 3 && mid >= 3 && last - mid >= 3) return formatShortDate(b.date);
    return null;
  });
}
