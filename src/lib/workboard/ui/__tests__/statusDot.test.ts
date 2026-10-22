import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusDot } from '../statusDot';
import type { WorkStage } from '../../workContexts';

test('revision and waiting win over the in-progress fold', () => {
  assert.deepEqual(statusDot('submitted'), { color: 'var(--wb-st-revision)', flat: false });
  assert.deepEqual(statusDot('blocked'),   { color: 'var(--wb-st-waiting)',  flat: false });
});
test('active and done stages glow', () => {
  assert.deepEqual(statusDot('in_progress'),     { color: 'var(--wb-st-progress)', flat: false });
  assert.deepEqual(statusDot('ready_to_submit'), { color: 'var(--wb-st-progress)', flat: false });
  assert.deepEqual(statusDot('done'),            { color: 'var(--wb-st-done)',     flat: false });
});
test('to do, backlog and unknown stages are the flat dot', () => {
  assert.deepEqual(statusDot('todo'),    { color: 'var(--wb-st-todo)', flat: true });
  assert.deepEqual(statusDot('backlog'), { color: 'var(--wb-st-todo)', flat: true });
  assert.deepEqual(statusDot('legacy' as WorkStage), { color: 'var(--wb-st-todo)', flat: true });
});
