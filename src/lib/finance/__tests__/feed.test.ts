// src/lib/finance/__tests__/feed.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDay, compareText, type FeedItem } from '../feed';

const it = (id: number, type: FeedItem['type'], entry_date: string, amount: number, label: string): FeedItem =>
  ({ id, type, entry_date, amount, label, goal_id: null, recurring: false });

test('groupByDay orders days newest first with per-day totals', () => {
  const groups = groupByDay([
    it(1, 'expense', '2026-10-17', 120, 'food'),
    it(2, 'expense', '2026-10-16', 150, 'transportation'),
    it(3, 'savings', '2026-10-16', 150, 'Concert'),
    it(4, 'allowance', '2026-10-15', 5300, 'Allowance'),
  ], '2026-10-17');
  assert.deepEqual(groups.map(g => g.title), ['Today', 'Yesterday', 'Thu, Oct 15']);
  assert.equal(groups[0].subtitle, 'Sat, Oct 17');
  assert.equal(groups[2].subtitle, '');
  assert.equal(groups[1].spent, 150);
  assert.equal(groups[1].saved, 150);
  assert.equal(groups[2].inflow, 5300);
});

test('compareText follows the old Activity Breakdown wording', () => {
  assert.deepEqual(compareText(860, 768, 'week'), { text: '▲ 12% vs last week', tone: 'up' });
  assert.deepEqual(compareText(500, 1000, 'month'), { text: '▼ 50% vs last month', tone: 'down' });
  assert.deepEqual(compareText(100, 100.2, 'week'), { text: '≈ same as last week', tone: 'muted' });
  assert.deepEqual(compareText(100, 0, 'month'), { text: 'No data last month', tone: 'muted' });
  assert.deepEqual(compareText(100, null, 'all'), { text: 'No prior period to compare', tone: 'muted' });
});

test('compareText reads a huge increase as a multiple, capped at over 100×', () => {
  assert.deepEqual(compareText(950, 100, 'week'), { text: '▲ 850% vs last week', tone: 'up' });
  assert.deepEqual(compareText(1000, 100, 'week'), { text: '▲ 10× vs last week', tone: 'up' });
  assert.deepEqual(compareText(5000, 20, 'month'), { text: '▲ over 100× vs last month', tone: 'up' });
});
