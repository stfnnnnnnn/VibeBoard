import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daypartFor, isDaypart, daypartScript, formatWhen, DAYPART_COPY } from '../daypart';

test('daypartFor boundaries', () => {
  assert.equal(daypartFor(4), 'night');
  assert.equal(daypartFor(5), 'morning');
  assert.equal(daypartFor(11), 'morning');
  assert.equal(daypartFor(12), 'afternoon');
  assert.equal(daypartFor(16), 'afternoon');
  assert.equal(daypartFor(17), 'evening');
  assert.equal(daypartFor(20), 'evening');
  assert.equal(daypartFor(21), 'night');
  assert.equal(daypartFor(0), 'night');
});

test('isDaypart', () => {
  assert.equal(isDaypart('night'), true);
  assert.equal(isDaypart('noon'), false);
  assert.equal(isDaypart(undefined), false);
});

function runScript(hour: number, search: string, allowOverride: boolean) {
  const doc = { documentElement: { dataset: {} as Record<string, string> } };
  class FakeDate { getHours() { return hour; } }
  new Function('document', 'location', 'Date', daypartScript(allowOverride))(doc, { search }, FakeDate);
  return doc.documentElement.dataset.daypart;
}

test('daypartScript matches daypartFor for every hour', () => {
  for (let h = 0; h < 24; h++) assert.equal(runScript(h, '', false), daypartFor(h), `hour ${h}`);
});

test('daypartScript honours ?daypart= only when allowed', () => {
  assert.equal(runScript(14, '?daypart=night', true), 'night');
  assert.equal(runScript(14, '?daypart=night', false), 'afternoon');
  assert.equal(runScript(14, '?daypart=bogus', true), 'afternoon');
});

test('formatWhen', () => {
  assert.equal(formatWhen(new Date(2026, 9, 23, 14, 40)), 'Friday · 2:40 PM');
});

test('copy is exact', () => {
  assert.equal(DAYPART_COPY.night.greeting, 'Still up?');
  assert.equal(DAYPART_COPY.night.login, "Your board's ready. Don't stay too late.");
  assert.equal(DAYPART_COPY.morning.login, "Let's set up the day.");
  assert.equal(DAYPART_COPY.afternoon.login, 'Pick up where you left off.');
  assert.equal(DAYPART_COPY.evening.login, 'Time to wrap up the day.');
});
