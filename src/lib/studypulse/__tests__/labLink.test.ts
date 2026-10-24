import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinePeriod, combinePeriods, periodNamesMatch, overallOfCurrents, periodCurrents } from '../labLink';

test('combine per period', () => {
  assert.equal(combinePeriod(86.3, 87.7, 70)!.toFixed(2), '86.72');
  assert.equal(combinePeriod(81.9, null, 70), 81.9);
  assert.equal(combinePeriod(null, 95, 70), 95);
  assert.equal(combinePeriod(null, null, 70), null);
  assert.deepEqual(combinePeriods([80, null], [90, 70], 50), [85, 70]);
});
test('period names must match by order, case-insensitively', () => {
  assert.equal(periodNamesMatch(['Midterm', 'Finals'], ['midterm', 'FINALS ']), true);
  assert.equal(periodNamesMatch(['Midterm', 'Finals'], ['Finals', 'Midterm']), false);
  assert.equal(periodNamesMatch(['Prelim', 'Midterm', 'Finals'], ['Midterm', 'Finals']), false);
});
test('the lecture final rule applied to combined period currents', () => {
  const keys = ['p1', 'p2'];
  assert.equal(overallOfCurrents([80, 90], keys, 'period', 'p2'), 90);
  assert.equal(overallOfCurrents([80, null], keys, 'period', 'p2'), null);
  assert.equal(overallOfCurrents([80, 90], keys, 'period', 'p9'), null);
  assert.equal(overallOfCurrents([80, null], keys, 'average', null), 80);
  assert.equal(overallOfCurrents([80, 90], keys, null, null), 85);
  assert.equal(overallOfCurrents([null, null], keys, 'average', null), null);
});
test('partner period currents: raw without a table, transmuted with one (both linked pages combine the same numbers)', () => {
  const preset = {
    final_mode: null, final_period_id: null,
    periods: [{ period_id: 1, name: 'Midterm', sort_order: 0, categories: [
      { cat_id: 10, name: 'Quizzes', weight: 60, is_singleton: 0, sort_order: 0, link_group: null, carry_score: 1, include_earlier: 0 },
      { cat_id: 11, name: 'Exam', weight: 40, is_singleton: 1, sort_order: 1, link_group: null, carry_score: 1, include_earlier: 0 },
    ] }],
  };
  const entries = { 10: [{ name: 'Quiz 1', score: '8', items: '10', grade: 80 }], 11: [] };
  assert.deepEqual(periodCurrents(preset, entries, null), [80]);
  assert.deepEqual(periodCurrents(preset, entries, { 8: { 10: 85 } }), [85]);
  // Lecture page combines (own, partner); lab page combines (partner, own): same value either way.
  const lec = [90], lab = periodCurrents(preset, entries, { 8: { 10: 85 } });
  assert.deepEqual(combinePeriods(lec, lab, 70), combinePeriods([90], [85], 70));
});
