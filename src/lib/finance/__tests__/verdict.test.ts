// src/lib/finance/__tests__/verdict.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointFor, previewSpend, verdictFor, verdictZones, type SpendSnapshot } from '../verdict';

// Mockup numbers: safe-to-spend 5,270.38 and 376.46/day over 14 days.
const S: SpendSnapshot = { current_balance: 7033.76, upcoming_required: 560, upcoming_savings: 500, days_until_next_allowance: 14 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1, `${a} ≈ ${b}`);

test('pointFor mirrors the safe-to-spend maths (10% buffer)', () => {
  const p = pointFor(S, S.current_balance);
  assert.equal(p.safe, 5270.38);
  assert.equal(p.raw, 5270.38);
  assert.equal(p.perDay, 376.46);
});

test('pointFor falls back to 14 days and never goes below zero', () => {
  const p = pointFor({ ...S, days_until_next_allowance: null }, 500);
  assert.equal(p.safe, 0);
  assert.equal(p.perDay, 0);
});

test('pointFor keeps the true deficit in raw while safe stays clamped', () => {
  // 500 − 560 − 500 − 50 (10% buffer) = −610.
  const p = pointFor(S, 500);
  assert.equal(p.raw, -610);
  assert.equal(p.safe, 0);
  // Negative balance: no buffer, deficit is balance − commitments.
  const n = pointFor(S, -200);
  assert.equal(n.raw, -1260);
  assert.equal(n.safe, 0);
  // previewSpend exposes both sides' deficit.
  const v = previewSpend(S, 6000);
  assert.ok(v.after.raw < 0);
  assert.equal(v.after.safe, 0);
  assert.equal(v.before.raw, 5270.38);
});

test('previewSpend verdicts', () => {
  assert.equal(previewSpend(S, 2500).verdict, 'comfortable');
  assert.equal(previewSpend(S, 2500).after.perDay, 215.74);
  assert.equal(previewSpend(S, 3200).verdict, 'tight');
  assert.equal(previewSpend(S, 6000).verdict, 'not_recommended');
  assert.equal(previewSpend(S, 38000).verdict, 'not_recommended');
});

test('billsCovered compares the remaining balance with upcoming commitments', () => {
  assert.equal(previewSpend(S, 2500).billsCovered, true);
  assert.equal(previewSpend(S, 6000).billsCovered, false);
});

test('verdictFor never calls a spend tight when there was no per-day budget to halve', () => {
  assert.equal(verdictFor({ balance: 100, safe: 0, raw: 0, perDay: 0 }, { balance: 50, safe: 1, raw: 1, perDay: 0 }), 'comfortable');
});

test('verdictZones gives the amounts where the verdict changes', () => {
  const z = verdictZones(S);
  near(z.tightFrom, 2927.99);
  near(z.notFrom, 5855.98);
  assert.equal(previewSpend(S, z.tightFrom - 2).verdict, 'comfortable');
  assert.equal(previewSpend(S, z.tightFrom + 2).verdict, 'tight');
  assert.equal(previewSpend(S, z.notFrom + 2).verdict, 'not_recommended');
});
