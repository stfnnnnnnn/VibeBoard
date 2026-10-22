import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkItem } from '../../workItems';
import type { ClassOccurrence } from '../../aggregate';
import { weekPickerDays, dueBarHeight, weekProgress } from '../weekPicker';

const W = '2026-10-19';           // Monday
const T = '2026-10-20';           // Tuesday
const item = (due: string | null, p: Partial<WorkItem> = {}) =>
  ({ source: 'owned', id: Math.random(), work_status: 'todo', due_at: due, estimated_hours: null, ...p }) as unknown as WorkItem;
const cls = (date: string, modality: string | null = null) =>
  ({ date, start_time: '08:00', end_time: '09:00', override: modality ? { modality } : null }) as unknown as ClassOccurrence;

test('weekPickerDays counts due work, hours and live classes per day', () => {
  const days = weekPickerDays(
    [item('2026-10-20', { estimated_hours: 2 }), item('2026-10-20 00:00:00'), item('2026-10-22'),
     item('2026-10-20', { work_status: 'done' }), item(null)],
    [cls('2026-10-19'), cls('2026-10-21'), cls('2026-10-21', 'cancelled')],
    W, T);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map(d => d.dueCount), [0, 2, 0, 1, 0, 0, 0]);
  assert.equal(days[1].dueHours, 2);
  assert.deepEqual(days.map(d => d.classCount), [1, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual(days.map(d => d.isPast), [true, false, false, false, false, false, false]);
  assert.equal(days[1].isToday, true);
});

test('dueBarHeight: 0 when empty, 18 for the busiest day, min 4 otherwise', () => {
  const days = weekPickerDays([item('2026-10-20'), item('2026-10-20'), item('2026-10-20'), item('2026-10-21')], [], W, T);
  assert.equal(dueBarHeight(days[0], days), 0);
  assert.equal(dueBarHeight(days[1], days), 18);
  assert.equal(dueBarHeight(days[2], days), 6);
});

test('weekProgress is 0 before, 1 after, fractional within the week', () => {
  assert.equal(weekProgress(W, '2026-10-12', 0), 0);   // today is before the shown week
  assert.equal(weekProgress(W, '2026-10-26', 0), 1);   // today is after the shown week
  assert.equal(weekProgress(W, '2026-10-19', 720), 0.5 / 7);
});

test('weekProgress accepts a datetime today and never hangs on a malformed one', () => {
  assert.equal(weekProgress(W, '2026-10-20 08:30:00', 0), 1 / 7);
  assert.equal(weekProgress(W, '2026-10-20T08:30:00+08:00', 720), 1.5 / 7);
  assert.equal(weekProgress(W, '2026-10-26 00:00:00', 0), 1);
  assert.equal(weekProgress(W, 'not-a-date', 0), 0);
});
