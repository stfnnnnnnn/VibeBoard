// src/lib/finance/__tests__/status.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeToSpendStatus } from '../status';

const base = { safe_to_spend: 0, upcoming_required: 0, upcoming_savings: 0, horizon_end: '2026-11-01', shortfall: 0, shortfall_coverable_by: null, flexible_categories: [] };

test('an empty account with nothing committed is not "over budget"', () => {
  assert.deepEqual(safeToSpendStatus({ ...base, current_balance: 0 }), { label: 'Nothing left to spend', tone: 'warn' });
});

test('a negative or committed-away safe-to-spend is still over budget', () => {
  assert.equal(safeToSpendStatus({ ...base, safe_to_spend: -120, current_balance: 50, upcoming_required: 170 }).label, 'Over budget this cycle');
  assert.equal(safeToSpendStatus({ ...base, current_balance: 300, upcoming_required: 300 }).label, 'Over budget this cycle');
});

test('a healthy balance is safe through the horizon', () => {
  assert.deepEqual(safeToSpendStatus({ ...base, safe_to_spend: 5000, current_balance: 6000 }), { label: 'Safe through Nov 1', tone: 'success' });
});

test('float noise around zero still reads as an empty account', () => {
  const empty = { label: 'Nothing left to spend', tone: 'warn' };
  assert.deepEqual(safeToSpendStatus({ ...base, current_balance: 1.4210854715202004e-14 }), empty);
  assert.deepEqual(safeToSpendStatus({ ...base, current_balance: -1.4210854715202004e-14 }), empty);
  assert.deepEqual(safeToSpendStatus({ ...base, safe_to_spend: -0.004, current_balance: 0.004 }), empty);
});

test('a balance that does not round to zero is not empty', () => {
  assert.equal(safeToSpendStatus({ ...base, current_balance: 0.01 }).label, 'Over budget this cycle');
  assert.equal(safeToSpendStatus({ ...base, current_balance: -0.01 }).label, 'Over budget this cycle');
});

test('a safe-to-spend that rounds to zero is over budget, not "tight"', () => {
  assert.equal(safeToSpendStatus({ ...base, safe_to_spend: 0.001, current_balance: 300, upcoming_required: 300 }).label, 'Over budget this cycle');
});

test('without current_balance the empty-account case never applies', () => {
  assert.equal(safeToSpendStatus({ ...base }).label, 'Over budget this cycle');
});
