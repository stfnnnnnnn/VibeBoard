// src/lib/finance/__tests__/pace.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paceStartFor, paceSeries, axisLabels } from '../pace';

const TODAY = '2026-10-17';

test('pace starts at the last allowance, or a week back when there is none or it is stale', () => {
  assert.equal(paceStartFor('2026-10-15', TODAY), '2026-10-15');
  assert.equal(paceStartFor(null, TODAY), '2026-10-11');
  assert.equal(paceStartFor('2026-09-01', TODAY), '2026-10-11'); // 46 days ago > 31
});

const input = {
  pace_start: '2026-10-15', horizon_end: '2026-10-31', per_day: 376.46,
  daily_spend: [{ date: '2026-10-15', amount: 150 }, { date: '2026-10-16', amount: 420 }, { date: '2026-10-17', amount: 120 }],
};

test('one bar per day from pace_start to horizon_end, future days flagged', () => {
  const s = paceSeries(input, TODAY);
  assert.equal(s.bars.length, 17);
  assert.equal(s.bars[2].isToday, true);
  assert.equal(s.bars[3].future, true);
  assert.equal(s.bars[1].over, true); // 420 > 376.46
  assert.equal(s.dayNumber, 3);
});

test('average and difference cover past days including today', () => {
  const s = paceSeries(input, TODAY);
  assert.equal(s.avg, 230);
  assert.equal(s.diff, 146.46);
  assert.ok(s.max >= 420);
});

test('windows longer than 31 days keep the 31 ending at horizon_end', () => {
  const s = paceSeries({ ...input, pace_start: '2026-09-01' }, TODAY);
  assert.equal(s.bars.length, 31);
  assert.equal(s.bars[30].date, '2026-10-31');
});

test('axis labels: start hidden when Today is near it; Today, middle and end shown', () => {
  const labels = axisLabels(paceSeries(input, TODAY).bars);
  assert.equal(labels[0], null);
  assert.equal(labels[2], 'Today');
  assert.equal(labels[8], 'Oct 23');
  assert.equal(labels[16], 'Oct 31');
  assert.equal(labels.filter(Boolean).length, 3);
});

test('axis labels: end hidden when Today is the second-to-last day', () => {
  const labels = axisLabels(paceSeries({ ...input, horizon_end: '2026-10-18' }, TODAY).bars);
  const last = labels.length - 1;
  assert.equal(labels[last - 1], 'Today');
  assert.equal(labels[last], null);
});

test('a long window starting today still contains today', () => {
  const s = paceSeries({ ...input, pace_start: '2026-10-15', horizon_end: '2026-11-15' }, '2026-10-15');
  assert.equal(s.bars.length, 31);
  assert.equal(s.bars[0].isToday, true);
  assert.equal(s.bars[0].date, '2026-10-15');
  assert.equal(axisLabels(s.bars)[0], 'Today');
});
