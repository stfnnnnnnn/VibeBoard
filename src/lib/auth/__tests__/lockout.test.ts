import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockSecondsLeft } from '../lockout';

test('lockSecondsLeft', () => {
  assert.equal(lockSecondsLeft(4, 10), 0);
  assert.equal(lockSecondsLeft(5, null), 0);
  assert.equal(lockSecondsLeft(5, 0), 600);
  assert.equal(lockSecondsLeft(5, 60), 540);
  assert.equal(lockSecondsLeft(9, 599), 1);
  assert.equal(lockSecondsLeft(5, 600), 0);
  assert.equal(lockSecondsLeft(5, -3), 600); // clock skew never extends past the full window
});
