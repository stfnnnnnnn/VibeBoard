import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinePeriod, combinePeriods, periodNamesMatch, overallOfCurrents } from '../labLink';

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
