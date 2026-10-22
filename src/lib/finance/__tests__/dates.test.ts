// src/lib/finance/__tests__/dates.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  manilaToday, addDays, addMonthsClamped, daysBetween, mondayOf, startOfMonth, endOfMonth,
  formatDay, formatWeekdayDate, msUntilNextManilaMidnight, formatShortDate, formatFullDate, formatMonthYear, formatLongDate,
} from '../dates';

test('manilaToday is the calendar date in Asia/Manila, not UTC', () => {
  assert.equal(manilaToday(new Date('2026-10-17T20:30:00Z')), '2026-10-18');
  assert.equal(manilaToday(new Date('2026-10-17T15:59:00Z')), '2026-10-17');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-10-19', 7), '2026-10-26');
});

test('addMonthsClamped keeps the day but clamps short months', () => {
  assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsClamped('2026-03-15', 1), '2026-04-15');
  assert.equal(addMonthsClamped('2026-12-10', 1), '2027-01-10');
});

test('daysBetween counts whole days b - a', () => {
  assert.equal(daysBetween('2026-10-17', '2026-10-31'), 14);
  assert.equal(daysBetween('2026-10-17', '2026-10-17'), 0);
  assert.equal(daysBetween('2026-10-17', '2026-10-15'), -2);
});

test('week and month boundaries', () => {
  assert.equal(mondayOf('2026-10-17'), '2026-10-12'); // Saturday
  assert.equal(mondayOf('2026-10-18'), '2026-10-12'); // Sunday belongs to the week before
  assert.equal(mondayOf('2026-10-12'), '2026-10-12');
  assert.equal(startOfMonth('2026-02-10'), '2026-02-01');
  assert.equal(endOfMonth('2026-02-10'), '2026-02-28');
  assert.equal(endOfMonth('2028-02-10'), '2028-02-29');
});

test('display formats', () => {
  assert.equal(formatDay('2026-10-17', '2026-10-17'), 'Today');
  assert.equal(formatDay('2026-10-16', '2026-10-17'), 'Yesterday');
  assert.equal(formatDay('2026-10-15', '2026-10-17'), 'Thu, Oct 15');
  assert.equal(formatWeekdayDate('2026-10-17'), 'Sat, Oct 17');
  assert.equal(formatDay('2025-08-20', '2026-10-17'), 'Wed, Aug 20, 2025');
  assert.equal(formatWeekdayDate('2026-10-17', '2026-01-01'), 'Sat, Oct 17');
  assert.equal(formatShortDate('2026-10-15'), 'Oct 15');
  assert.equal(formatFullDate('2026-08-25'), 'Aug 25, 2026');
  assert.equal(formatMonthYear('2027-06-10'), 'Jun 2027');
  assert.equal(formatLongDate('2026-10-17'), 'Saturday, Oct 17');
});

test('msUntilNextManilaMidnight counts to 16:00 UTC (Manila midnight)', () => {
  assert.equal(msUntilNextManilaMidnight(new Date('2026-10-18T15:59:59Z')), 1000);
  assert.equal(msUntilNextManilaMidnight(new Date('2026-10-18T16:00:00Z')), 86_400_000);
  assert.equal(msUntilNextManilaMidnight(new Date('2026-10-18T16:00:01Z')), 86_399_000);
  assert.equal(msUntilNextManilaMidnight(new Date('2026-10-18T04:00:00Z')), 12 * 3_600_000);
  // Lands on the instant manilaToday() changes.
  const now = new Date('2026-10-18T09:12:34.567Z');
  const at = new Date(now.getTime() + msUntilNextManilaMidnight(now));
  assert.equal(manilaToday(at), addDays(manilaToday(now), 1));
  assert.equal(manilaToday(new Date(at.getTime() - 1)), manilaToday(now));
});
