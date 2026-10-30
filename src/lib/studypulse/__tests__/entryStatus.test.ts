import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusFor } from '../entryStatus';

test('statusFor: score, items and grade all present forces Done', () => {
  assert.equal(statusFor('Pending', 18, 20, 90), 'Done');
  assert.equal(statusFor('Missing', 0, 20, 0), 'Done'); // zeros count as present
});

test('statusFor: any of the three missing keeps the given status', () => {
  assert.equal(statusFor('Pending', null, 20, 90), 'Pending');
  assert.equal(statusFor('Pending', 18, null, 90), 'Pending');
  assert.equal(statusFor('In Progress', 18, 20, null), 'In Progress');
  assert.equal(statusFor('Done', null, null, null), 'Done');
});
