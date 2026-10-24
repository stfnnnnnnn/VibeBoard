import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbourIndex, tabTarget } from '../focusTrap';

const order = ['title', 'close', 'name', 'next'];

test('tabTarget: from outside the cycle (body, the panel) Tab enters at the first stop, Shift+Tab at the last', () => {
  assert.equal(tabTarget(order, null, false), 'title');
  assert.equal(tabTarget(order, 'body', false), 'title');
  assert.equal(tabTarget(order, 'panel', true), 'next');
});

test('tabTarget: wraps at both ends, including Shift+Tab from the title', () => {
  assert.equal(tabTarget(order, 'title', true), 'next');
  assert.equal(tabTarget(order, 'next', false), 'title');
});

test('tabTarget: inside the cycle the browser moves focus natively', () => {
  assert.equal(tabTarget(order, 'title', false), null);
  assert.equal(tabTarget(order, 'name', true), null);
  assert.equal(tabTarget([], 'x', false), null);
});

test('neighbourIndex: next, else previous, else none', () => {
  assert.equal(neighbourIndex(3, 0), 1);
  assert.equal(neighbourIndex(3, 1), 2);
  assert.equal(neighbourIndex(3, 2), 1);
  assert.equal(neighbourIndex(1, 0), null);
});
