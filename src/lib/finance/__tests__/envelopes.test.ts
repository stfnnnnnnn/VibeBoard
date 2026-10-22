// src/lib/finance/__tests__/envelopes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelopes, envelopeSummary, groupEnvelopes, nextCycle, planAllowanceCeiling, templateToRows, type BudgetRow, type SavingsRow } from '../envelopes';

const b = (category: string, tier: BudgetRow['tier'], cap: number | null, spent: number, extra: Partial<BudgetRow> = {}): BudgetRow => ({
  budget_id: 1, category, cap_amount: cap, plan_amount: cap, is_override: false, override_reason: null,
  tier, spent, period_start: '2026-10-15', period_end: '2026-10-28', ...extra,
});
const savings: SavingsRow = { budget_id: 9, cap_amount: 265, plan_amount: 265, is_override: false, override_reason: null, funded: 0, tier: 'target', period_start: '2026-10-15', period_end: '2026-10-28' };

test('envelopes: only capped categories, ordered by tier then size, savings included', () => {
  const r = buildEnvelopes([
    b('miscellaneous', 'flexible', 265, 0), b('food', 'required', 1590, 500), b('grocery', 'required', 530, 0), b('leisure', 'flexible', null, 40),
  ], savings, '2026-10-17');
  assert.deepEqual(r.envelopes.map(x => x.category), ['food', 'grocery', 'savings', 'miscellaneous']);
  assert.equal(r.envelopes[0].left, 1090);
  assert.equal(r.envelopes[2].isSavings, true);
  assert.equal(r.elapsedPct, 15); // 2 of 13 days
  assert.deepEqual(r.period, { start: '2026-10-15', end: '2026-10-28' });
});

test('over cap and spending faster than plan', () => {
  const r = buildEnvelopes([b('food', 'required', 1000, 1120), b('grocery', 'required', 1000, 400)], null, '2026-10-17');
  assert.equal(r.envelopes[0].over, true);
  assert.equal(r.envelopes[0].left, -120);
  assert.equal(r.envelopes[1].fasterThanPlan, true); // 40% used at 15% through
});

test('nextCycle starts the day after the last one, same length and amount', () => {
  assert.deepEqual(nextCycle({ last_allowance_amount: 5300, last_period_start: '2026-08-26', last_period_end: '2026-09-22' }, '2026-10-17'),
    { start: '2026-09-23', end: '2026-10-20', days: 28, amount: 5300 });
  assert.equal(nextCycle({ last_allowance_amount: 5300, last_period_start: '2026-10-01', last_period_end: '2026-10-28' }, '2026-10-17'), null);
  assert.equal(nextCycle({ last_allowance_amount: null, last_period_start: null, last_period_end: null }, '2026-10-17'), null);
});

test('nextCycle rolls a lapsed plan forward to the period containing today', () => {
  // Jun 1–28 → Jun 29–Jul 26 → Jul 27–Aug 23 → Aug 24–Sep 20 → Sep 21–Oct 18.
  assert.deepEqual(nextCycle({ last_allowance_amount: 5300, last_period_start: '2026-06-01', last_period_end: '2026-06-28' }, '2026-10-17'),
    { start: '2026-09-21', end: '2026-10-18', days: 28, amount: 5300 });
});

test('nextCycle keeps a period that ends exactly today', () => {
  assert.deepEqual(nextCycle({ last_allowance_amount: 5300, last_period_start: '2026-08-26', last_period_end: '2026-09-22' }, '2026-10-20'),
    { start: '2026-09-23', end: '2026-10-20', days: 28, amount: 5300 });
  // One day later it rolls to the following period.
  assert.deepEqual(nextCycle({ last_allowance_amount: 5300, last_period_start: '2026-08-26', last_period_end: '2026-09-22' }, '2026-10-21'),
    { start: '2026-10-21', end: '2026-11-17', days: 28, amount: 5300 });
});

test('planAllowanceCeiling counts money already used only when re-saving the running cycle', () => {
  const current = { start: '2026-10-15', used: 1234.5 };
  assert.equal(planAllowanceCeiling(3000, current, '2026-10-15'), 4234.5);
  assert.equal(planAllowanceCeiling(3000, current, '2026-10-16'), 3000); // a different period
  assert.equal(planAllowanceCeiling(3000, null, '2026-10-15'), 3000); // a new plan
  assert.equal(planAllowanceCeiling(3000, { start: null, used: 50 }, '2026-10-15'), 3000);
  assert.equal(planAllowanceCeiling(null, current, '2026-10-15'), null); // balance unknown
});

test('templateToRows matches the builder row shape', () => {
  assert.deepEqual(templateToRows([
    { category: 'food', priority_tier: 'required', allocation_type: 'percent', amount: null, percent: 30 },
    { category: 'savings', priority_tier: 'target', allocation_type: 'fixed', amount: 265, percent: null },
  ]), [
    { category: 'food', priority_tier: 'required', allocation_type: 'percent', value: 30 },
    { category: 'savings', priority_tier: 'target', allocation_type: 'fixed', value: 265 },
  ]);
});

test('groupEnvelopes: tier order, empty tiers dropped, overspend counts as 0 left', () => {
  const { envelopes } = buildEnvelopes([
    b('miscellaneous', 'flexible', 265, 0), b('food', 'required', 1590, 500), b('grocery', 'required', 530, 600),
  ], savings, '2026-10-17');
  const g = groupEnvelopes(envelopes);
  assert.deepEqual(g.map(x => x.tier), ['required', 'target', 'flexible']);
  assert.deepEqual(g[0].envelopes.map(x => x.category), ['food', 'grocery']);
  assert.equal(g[0].left, 1090); // grocery is ₱70 over: adds 0, not -70
  assert.equal(g[0].cap, 2120);
  assert.equal(g[1].envelopes[0].isSavings, true);
  assert.deepEqual(groupEnvelopes(buildEnvelopes([b('food', 'required', 100, 0)], null, '2026-10-17').envelopes).map(x => x.tier), ['required']);
  assert.deepEqual(groupEnvelopes([]), []);
});

test('envelopeSummary: left clamped per envelope, spent includes savings funded and overspend', () => {
  const { envelopes } = buildEnvelopes([b('food', 'required', 1590, 500), b('grocery', 'required', 530, 600)],
    { ...savings, funded: 65 }, '2026-10-17');
  assert.deepEqual(envelopeSummary(envelopes), { left: 1290, spent: 1165, cap: 2385, pct: 49 });
  assert.deepEqual(envelopeSummary([]), { left: 0, spent: 0, cap: 0, pct: 0 });
});
