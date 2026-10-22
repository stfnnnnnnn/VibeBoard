import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcGrade } from '../grades';

test('calcGrade', () => {
  assert.equal(calcGrade('24', '25'), 96);
  assert.equal(calcGrade('2', '3'), 66.67);
  assert.equal(calcGrade('', '25'), null);
  assert.equal(calcGrade('5', '0'), null);
  assert.equal(calcGrade('x', '10'), null);
});
