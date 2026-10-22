// src/lib/finance/logContext.ts
/* Data for the composer's category chips and the drawer's "Log again" tiles (spec §7). */
export interface LoggedRow { type: 'expense' | 'savings'; category: string | null; goal_id: number | null; goal_name: string | null; amount: number; entry_date: string }
export interface LogRepeat { type: 'expense' | 'savings'; category: string | null; goal_id: number | null; goal_name: string | null; amount: number }

const DEFAULT_TOP = ['food', 'transportation', 'academic', 'grocery'];

export function topCategories(rows: LoggedRow[], limit = 4): string[] {
  const stats = new Map<string, { count: number; last: string }>();
  for (const r of rows) {
    if (r.type !== 'expense' || !r.category) continue;
    const s = stats.get(r.category) ?? { count: 0, last: '' };
    s.count += 1;
    if (r.entry_date > s.last) s.last = r.entry_date;
    stats.set(r.category, s);
  }
  const ranked = [...stats.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last))
    .map(([cat]) => cat);
  for (const d of DEFAULT_TOP) if (!ranked.includes(d)) ranked.push(d);
  return ranked.slice(0, limit);
}

export function repeatsFrom(rows: LoggedRow[], limit = 4): LogRepeat[] {
  const groups = new Map<string, { repeat: LogRepeat; count: number; last: string }>();
  for (const r of rows) {
    const key = `${r.type}|${r.category ?? ''}|${r.goal_id ?? ''}|${r.amount.toFixed(2)}`;
    const g = groups.get(key) ?? { repeat: { type: r.type, category: r.category, goal_id: r.goal_id, goal_name: r.goal_name, amount: r.amount }, count: 0, last: '' };
    g.count += 1;
    if (r.entry_date > g.last) g.last = r.entry_date;
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter(g => g.count >= 2)
    .sort((a, b) => b.last.localeCompare(a.last) || b.count - a.count)
    .slice(0, limit)
    .map(g => g.repeat);
}
