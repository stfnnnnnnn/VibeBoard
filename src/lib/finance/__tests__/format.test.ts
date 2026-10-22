// src/lib/finance/__tests__/format.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPeso, formatPesoWhole, formatPesoCompact, splitPeso, roundsToZero } from '../format';

test('formatPeso groups thousands and keeps two decimals', () => {
  assert.equal(formatPeso(5270.38), '₱5,270.38');
  assert.equal(formatPeso(0), '₱0.00');
  assert.equal(formatPeso(1234567.891), '₱1,234,567.89');
});

test('formatPeso puts a true minus sign before the peso sign', () => {
  assert.equal(formatPeso(-120), '−₱120.00');
});

test('formatPesoWhole rounds to whole pesos', () => {
  assert.equal(formatPesoWhole(376.46), '₱376');
  assert.equal(formatPesoWhole(9500), '₱9,500');
});

test('formatPesoCompact shortens thousands and millions', () => {
  assert.equal(formatPesoCompact(999), '₱999');
  assert.equal(formatPesoCompact(1000), '₱1k');
  assert.equal(formatPesoCompact(1200), '₱1.2k');
  assert.equal(formatPesoCompact(38000), '₱38k');
  assert.equal(formatPesoCompact(1240000), '₱1.2M');
});

test('splitPeso separates the cents for the hero', () => {
  assert.deepEqual(splitPeso(5270.38), { whole: '₱5,270', cents: '.38' });
  assert.deepEqual(splitPeso(-3), { whole: '−₱3', cents: '.00' });
});

test('formatPeso never shows a minus for a value that rounds to zero', () => {
  assert.equal(formatPeso(-0.004), '₱0.00');
  assert.equal(formatPeso(-0), '₱0.00');
  assert.equal(formatPeso(-0.005), '−₱0.01');
});

test('formatPesoWhole never shows a minus for a value that rounds to zero', () => {
  assert.equal(formatPesoWhole(-0.4), '₱0');
  assert.equal(formatPesoWhole(-0.6), '−₱1');
});

test('formatPesoCompact picks the unit after rounding', () => {
  assert.equal(formatPesoCompact(999.6), '₱1k');
  assert.equal(formatPesoCompact(999.4), '₱999');
  assert.equal(formatPesoCompact(999_950), '₱1M');
  assert.equal(formatPesoCompact(-999.6), '−₱1k');
  assert.equal(formatPesoCompact(-0.3), '₱0');
});

test('roundsToZero flags amounts that display as zero (Money drops its sign)', () => {
  assert.equal(roundsToZero(0.004), true);
  assert.equal(roundsToZero(-0.004), true);
  assert.equal(roundsToZero(0.005), false);
  assert.equal(roundsToZero(-12), false);
});
