// src/lib/finance/__tests__/logContext.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topCategories, repeatsFrom, type LoggedRow } from '../logContext';

const e = (category: string, amount: number, entry_date: string): LoggedRow => ({ type: 'expense', category, goal_id: null, goal_name: null, amount, entry_date });
const rows: LoggedRow[] = [
  e('food', 120, '2026-10-17'), e('food', 120, '2026-10-14'), e('food', 95, '2026-10-09'),
  e('transportation', 150, '2026-10-16'), e('transportation', 150, '2026-10-09'),
  e('leisure', 380, '2026-10-12'),
  { type: 'savings', category: null, goal_id: 7, goal_name: 'Concert', amount: 150, entry_date: '2026-10-16' },
  { type: 'savings', category: null, goal_id: 7, goal_name: 'Concert', amount: 150, entry_date: '2026-10-02' },
];

test('topCategories ranks by count, then recency, then pads with defaults', () => {
  assert.deepEqual(topCategories(rows), ['food', 'transportation', 'leisure', 'academic']);
  assert.deepEqual(topCategories([]), ['food', 'transportation', 'academic', 'grocery']);
});

test('repeatsFrom keeps exact combinations logged at least twice, most recent first', () => {
  const r = repeatsFrom(rows);
  assert.deepEqual(r.map(x => `${x.type}:${x.category ?? x.goal_name}:${x.amount}`), [
    'expense:food:120', 'expense:transportation:150', 'savings:Concert:150',
  ]);
});
