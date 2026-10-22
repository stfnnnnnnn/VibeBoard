import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrefKey, clampPrefValue, rowsToPrefs, extraKey, targetKey } from '../prefs';

test('parsePrefKey accepts only extra:/target: with safe ids', () => {
  assert.deepEqual(parsePrefKey('extra:c12'), { kind: 'extra', id: 'c12' });
  assert.deepEqual(parsePrefKey('target:overall'), { kind: 'target', id: 'overall' });
  assert.deepEqual(parsePrefKey('extra:legacy-quizzes'), { kind: 'extra', id: 'legacy-quizzes' });
  assert.equal(parsePrefKey('extra:C12'), null);
  assert.equal(parsePrefKey('foo:c1'), null);
  assert.equal(parsePrefKey('extra:'), null);
  assert.equal(parsePrefKey(42), null);
  assert.equal(extraKey('c3'), 'extra:c3');
  assert.equal(targetKey('p9'), 'target:p9');
});

test('clampPrefValue', () => {
  assert.equal(clampPrefValue('extra', 3.6), 4);
  assert.equal(clampPrefValue('extra', -2), 0);
  assert.equal(clampPrefValue('extra', 99), 50);
  assert.equal(clampPrefValue('target', 89.25), 89.3);
  assert.equal(clampPrefValue('target', 140), 100);
  assert.equal(clampPrefValue('target', Number.NaN), null);
});

test('rowsToPrefs splits keys and ignores junk', () => {
  assert.deepEqual(
    rowsToPrefs([{ key: 'extra:c1', value: 2 }, { key: 'target:p1', value: 89 }, { key: 'bad', value: 1 }]),
    { extras: { c1: 2 }, targets: { p1: 89 } },
  );
});
