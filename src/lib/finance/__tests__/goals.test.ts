// src/lib/finance/__tests__/goals.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalState, goalGuidance, goalMarkerDate, timelineLayout, stackLabelRows, type GoalInput } from '../goals';

const TODAY = '2026-10-17';
const base: GoalInput = {
  goal_id: 1, goal_name: 'G', target_amount: 10000, saved: 500, target_date: null,
  avg_per_week: 61.4, required_per_week: null, projected_date: null, pace_status: null,
};

test('a passed target date wins over pace maths', () => {
  const g = { ...base, target_date: '2026-08-25', required_per_week: 9500, pace_status: 'behind' as const };
  assert.equal(goalState(g, TODAY), 'date_passed');
  const guide = goalGuidance(g, TODAY);
  assert.equal(guide.text, 'The target date (Aug 25, 2026) has passed. ₱9,500 to go.');
  assert.equal(guide.action, 'pick_date');
  assert.equal(guide.tone, 'warn');
});

test('no date uses the projection', () => {
  const g = { ...base, target_amount: 3000, saved: 650, avg_per_week: 66, projected_date: '2027-06-10' };
  assert.equal(goalState(g, TODAY), 'no_date');
  assert.equal(goalGuidance(g, TODAY).text, "At ₱66/wk you'll reach it around Jun 2027.");
  assert.equal(goalGuidance(g, TODAY).action, 'set_date');
});

test('no date and no savings yet', () => {
  assert.equal(goalGuidance({ ...base, saved: 0, avg_per_week: 0 }, TODAY).text, 'Add savings to see when you\'ll reach it.');
});

test('behind and on pace', () => {
  const behind = { ...base, target_date: '2026-12-20', required_per_week: 150, pace_status: 'behind' as const };
  assert.equal(goalState(behind, TODAY), 'behind');
  assert.equal(goalGuidance(behind, TODAY).text, "Save ₱150/wk to hit Dec 20. You're averaging ₱61/wk.");
  const onPace = { ...base, target_date: '2027-12-20', pace_status: 'ahead' as const };
  assert.equal(goalState(onPace, TODAY), 'on_pace');
  assert.equal(goalGuidance(onPace, TODAY).text, 'On pace for Dec 20 at ₱61/wk.');
});

test('done beats everything', () => {
  assert.equal(goalState({ ...base, saved: 10000, target_date: '2026-01-01' }, TODAY), 'done');
});

test('marker date prefers the target, then the projection', () => {
  assert.equal(goalMarkerDate({ ...base, target_date: '2026-08-25', projected_date: '2029-01-01' }), '2026-08-25');
  assert.equal(goalMarkerDate({ ...base, projected_date: '2027-06-10' }), '2027-06-10');
  assert.equal(goalMarkerDate(base), null);
});

test('timelineLayout spans every marker plus a month either side', () => {
  const goals = [
    { ...base, goal_id: 1, target_date: '2026-08-25' },
    { ...base, goal_id: 2, projected_date: '2027-06-10' },
  ];
  const t = timelineLayout(goals, TODAY);
  assert.equal(t.ticks[0].date, '2026-07-01');
  assert.ok(t.todayPos > 0 && t.todayPos < 100);
  assert.equal(t.markers.length, 2);
  assert.ok(t.markers[0].pos < t.todayPos && t.markers[1].pos > t.todayPos);
  assert.equal(t.markers[1].projected, true);
  assert.equal(t.useList, false);
});

test('close markers stack into rows; more than 6 goals switch to a list', () => {
  const close = [1, 2, 3].map(i => ({ ...base, goal_id: i, target_date: `2027-01-0${i}` }));
  const rows = timelineLayout(close, TODAY).markers.map(m => m.row);
  assert.deepEqual(rows, [0, 1, 2]);
  const many = Array.from({ length: 7 }, (_, i) => ({ ...base, goal_id: i, target_date: '2027-01-01' }));
  assert.equal(timelineLayout(many, TODAY).useList, true);
});

test('stackLabelRows lifts a label only when it would touch another on the same row', () => {
  // Today holds 100–140 on row 0: the first label overlaps it (row 1); the second clears Today (row 0).
  const rows = stackLabelRows(
    [{ left: 90, right: 200 }, { left: 150, right: 260 }, { left: 300, right: 340 }],
    [{ left: 100, right: 140, row: 0 }],
  );
  assert.deepEqual(rows, [1, 0, 0]);
});

test('stackLabelRows reuses the row that frees up first when all rows are full', () => {
  const l = [{ left: 0, right: 100 }, { left: 10, right: 120 }, { left: 20, right: 90 }, { left: 30, right: 60 }];
  assert.deepEqual(stackLabelRows(l, [], 3), [0, 1, 2, 2]);
});
