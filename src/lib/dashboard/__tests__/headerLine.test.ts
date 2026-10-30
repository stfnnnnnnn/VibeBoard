import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manilaClock, greetingFor, weekOfTerm, dateLine } from '../headerLine';

test('manilaClock reads Asia/Manila wall time', () => {
  assert.deepEqual(manilaClock(new Date('2026-10-30T07:30:00Z')), { date: '2026-10-30', hour: 15, hhmm: '15:30' });
});
test('manilaClock rolls the date past Manila midnight', () => {
  assert.deepEqual(manilaClock(new Date('2026-10-30T17:05:00Z')), { date: '2026-10-31', hour: 1, hhmm: '01:05' });
});
test('greeting boundaries', () => {
  assert.equal(greetingFor(0), 'Good morning');
  assert.equal(greetingFor(11), 'Good morning');
  assert.equal(greetingFor(12), 'Good afternoon');
  assert.equal(greetingFor(17), 'Good afternoon');
  assert.equal(greetingFor(18), 'Good evening');
});
test('weekOfTerm counts 7-day weeks from the start date', () => {
  assert.equal(weekOfTerm('2026-09-14', '2026-12-12', '2026-09-14'), 1);
  assert.equal(weekOfTerm('2026-09-14', '2026-12-12', '2026-09-20'), 1);
  assert.equal(weekOfTerm('2026-09-14', '2026-12-12', '2026-09-21'), 2);
  assert.equal(weekOfTerm('2026-09-14', '2026-12-12', '2026-10-30'), 7);
});
test('weekOfTerm is null outside the term or without a start', () => {
  assert.equal(weekOfTerm(null, null, '2026-10-30'), null);
  assert.equal(weekOfTerm('2026-11-01', null, '2026-10-30'), null);
  assert.equal(weekOfTerm('2026-06-01', '2026-08-30', '2026-10-30'), null);
});
test('dateLine joins weekday, week and greeting; omits a missing week', () => {
  assert.equal(dateLine('2026-10-30', 15, 7), 'Friday, Oct 30 · Week 7 · Good afternoon');
  assert.equal(dateLine('2026-10-30', 8, null), 'Friday, Oct 30 · Good morning');
});
