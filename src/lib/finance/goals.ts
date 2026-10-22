// src/lib/finance/goals.ts
/* Goal state, guidance copy and timeline geometry (spec §10.1). The old "162W BEHIND" badge
   came from pace maths running against a target date that had already passed; date_passed
   is checked first so that can't happen again. */
import { formatPesoWhole, formatPeso } from './format';
import { formatShortDate, formatFullDate, formatMonthYear, addMonthsClamped, startOfMonth, daysBetween } from './dates';

export interface GoalInput {
  goal_id: number;
  goal_name: string;
  target_amount: number;
  saved: number;
  target_date: string | null;
  avg_per_week: number;
  required_per_week: number | null;
  projected_date: string | null;
  pace_status: 'ahead' | 'on_pace' | 'behind' | null;
}
export type GoalState = 'done' | 'date_passed' | 'behind' | 'on_pace' | 'no_date';

export function goalState(g: GoalInput, today: string): GoalState {
  if (g.target_amount > 0 && g.saved >= g.target_amount) return 'done';
  if (g.target_date && g.target_date < today) return 'date_passed';
  if (!g.target_date) return 'no_date';
  if (g.pace_status === 'behind') return 'behind';
  return 'on_pace';
}

export function goalGuidance(g: GoalInput, today: string): { text: string; action: 'pick_date' | 'set_date' | null; tone: 'warn' | 'info' | 'success' } {
  const remaining = Math.max(0, g.target_amount - g.saved);
  switch (goalState(g, today)) {
    case 'done':
      return { text: `Goal reached: ${formatPeso(g.saved)} saved.`, action: null, tone: 'success' };
    case 'date_passed':
      return { text: `The target date (${formatFullDate(g.target_date!)}) has passed. ${formatPesoWhole(remaining)} to go.`, action: 'pick_date', tone: 'warn' };
    case 'behind':
      return { text: `Save ${formatPesoWhole(g.required_per_week ?? 0)}/wk to hit ${formatShortDate(g.target_date!)}. You're averaging ${formatPesoWhole(g.avg_per_week)}/wk.`, action: null, tone: 'warn' };
    case 'on_pace':
      return { text: `On pace for ${formatShortDate(g.target_date!)} at ${formatPesoWhole(g.avg_per_week)}/wk.`, action: null, tone: 'success' };
    case 'no_date':
      return g.projected_date && g.avg_per_week > 0
        ? { text: `At ${formatPesoWhole(g.avg_per_week)}/wk you'll reach it around ${formatMonthYear(g.projected_date)}.`, action: 'set_date', tone: 'info' }
        : { text: "Add savings to see when you'll reach it.", action: 'set_date', tone: 'info' };
  }
}

export function goalMarkerDate(g: GoalInput): string | null {
  return g.target_date ?? g.projected_date ?? null;
}

const MAX_TIMELINE_GOALS = 6;
const MIN_GAP_PCT = 18; // closer than this and the marker cards would overlap

export function timelineLayout(goals: GoalInput[], today: string) {
  const dated = goals.map(g => ({ g, date: goalMarkerDate(g) })).filter((x): x is { g: GoalInput; date: string } => x.date !== null);
  const dates = [today, ...dated.map(x => x.date)].sort();
  const start = addMonthsClamped(startOfMonth(dates[0]), -1);
  const end = addMonthsClamped(startOfMonth(dates[dates.length - 1]), 2); // one full month after the last marker
  const span = Math.max(1, daysBetween(start, end));
  const posOf = (d: string) => Math.min(100, Math.max(0, (daysBetween(start, d) / span) * 100));

  const ticks: { date: string; label: string; pos: number }[] = [];
  const monthCount = Math.round(daysBetween(start, end) / 30.4);
  const step = Math.max(1, Math.ceil(monthCount / 5)); // about five labels
  for (let m = start; m <= end; m = addMonthsClamped(m, step)) {
    ticks.push({ date: m, label: formatMonthYear(m).replace(/ (\d{2})(\d{2})$/, " '$2"), pos: posOf(m) });
  }

  const sorted = dated.map(x => ({ goal_id: x.g.goal_id, pos: posOf(x.date), projected: !x.g.target_date })).sort((a, b) => a.pos - b.pos);
  const lastPosInRow: number[] = [-Infinity, -Infinity, -Infinity];
  const markers = sorted.map(m => {
    let row = lastPosInRow.findIndex(p => m.pos - p >= MIN_GAP_PCT);
    if (row === -1) row = lastPosInRow.indexOf(Math.min(...lastPosInRow)); // all full: reuse the oldest row
    lastPosInRow[row] = m.pos;
    return { ...m, row: row as 0 | 1 | 2 };
  });

  return { ticks, todayPos: posOf(today), markers, useList: goals.length > MAX_TIMELINE_GOALS };
}

/* Pixel-accurate label rows for the timeline strip. `timelineLayout` stacks by percentage, which
   can't know how wide a label is at a given strip width (labels collided at 641–820px). Given the
   measured horizontal extent of each label (sorted by left edge) plus extents already taken in a
   row (the "Today" label sits on row 0), each label takes the first row where it clears every
   other label by `gap` px. If no row is free it takes the row whose last label ends earliest. */
export function stackLabelRows(
  labels: { left: number; right: number }[],
  reserved: { left: number; right: number; row: number }[] = [],
  rowCount = 3,
  gap = 8,
): number[] {
  const rows: { left: number; right: number }[][] = Array.from({ length: rowCount }, () => []);
  for (const r of reserved) if (r.row >= 0 && r.row < rowCount) rows[r.row].push(r);
  const clear = (row: { left: number; right: number }[], l: { left: number; right: number }) =>
    row.every(o => l.right + gap <= o.left || l.left >= o.right + gap);
  return labels.map(l => {
    let row = rows.findIndex(r => clear(r, l));
    if (row === -1) {
      const ends = rows.map(r => Math.max(-Infinity, ...r.map(o => o.right)));
      row = ends.indexOf(Math.min(...ends));
    }
    rows[row].push(l);
    return row;
  });
}
