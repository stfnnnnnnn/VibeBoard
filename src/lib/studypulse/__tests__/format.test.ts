import { test } from 'node:test';
import assert from 'node:assert/strict';
import { f1, gradeTone, todayManila, shortDate, dueNote, submittedNote } from '../ui/format';

test('f1 and gradeTone', () => {
  assert.equal(f1(87.19), '87.2');
  assert.equal(f1(100), '100.0');
  assert.equal(gradeTone(null), 'none');
  assert.equal(gradeTone(75), 'success');
  assert.equal(gradeTone(70), 'warn');
  assert.equal(gradeTone(64.9), 'danger');
});

test('todayManila uses Asia/Manila, not UTC', () => {
  // 2026-10-21T17:30Z is already Oct 22 in Manila (UTC+8).
  assert.equal(todayManila(new Date('2026-10-21T17:30:00Z')), '2026-10-22');
});

test('shortDate omits the current year only', () => {
  assert.equal(shortDate('2026-09-04', '2026-10-22'), 'Sep 4');
  assert.equal(shortDate('2025-12-01', '2026-10-22'), 'Dec 1, 2025');
});

test('dueNote', () => {
  const T = '2026-10-22';
  assert.deepEqual(dueNote('2026-10-22', T, false), { text: 'today', tone: 'warn' });
  assert.deepEqual(dueNote('2026-10-23', T, false), { text: 'tomorrow', tone: 'warn' });
  assert.deepEqual(dueNote('2026-10-27', T, false), { text: 'in 5 days', tone: 'muted' });
  assert.equal(dueNote('2026-11-10', T, false), null);
  assert.deepEqual(dueNote('2026-10-20', T, false), { text: '2 days overdue', tone: 'danger' });
  assert.equal(dueNote('2026-10-20', T, true), null);
  assert.equal(dueNote('', T, false), null);
});

test('submittedNote', () => {
  assert.deepEqual(submittedNote('2026-09-04', '2026-09-04'), { text: 'on time', tone: 'muted' });
  assert.deepEqual(submittedNote('2026-09-18', '2026-09-19'), { text: '1 day late', tone: 'danger' });
  assert.deepEqual(submittedNote('2026-09-18', '2026-09-21'), { text: '3 days late', tone: 'danger' });
  assert.equal(submittedNote('', '2026-09-21'), null);
});
