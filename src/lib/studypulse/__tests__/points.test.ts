import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsOf, periodPoints, rawPercent, fmtWeight, whatIfOverrides } from '../points';
import { projectPeriod, type CategoryInput } from '../projection';
import type { TransmutationTable } from '../../transmutation';

const near = (actual: number | null, expected: number, tol = 1e-9) => {
  assert.ok(actual !== null, `expected ${expected}, got null`);
  assert.ok(Math.abs((actual as number) - expected) <= tol, `expected ${expected}±${tol}, got ${actual}`);
};
const cat = (o: Partial<CategoryInput> & Pick<CategoryInput, 'key' | 'weight'>): CategoryInput => ({
  name: o.key, color: '', graded: [], pendingNames: [], extra: 0, singleton: false, noun: 'Item', ...o,
});

test('pointsOf: avg × raw weight / 100, not renormalised', () => {
  near(pointsOf(80, 40), 32);
  near(pointsOf(87.5, 36), 31.5);
  near(pointsOf(95, 24), 22.8);
  assert.equal(pointsOf(null, 40), null);
  near(pointsOf(80, 0), 0);
  near(pointsOf(80, -5), 0);
});

test('periodPoints: Midterm of the mockup earns 86.3 of 100, all of it in', () => {
  const p = projectPeriod({ key: 'p1', name: 'Midterm', target: 85, categories: [
    cat({ key: 'q', weight: 36, graded: [85, 90] }),
    cat({ key: 't', weight: 24, graded: [90, 100] }),
    cat({ key: 'e', weight: 40, graded: [80], singleton: true }),
  ] });
  const pts = periodPoints(p.categories);
  near(pts.earned, 86.3);
  assert.equal(pts.gradedWeight, 100);
  assert.equal(pts.totalWeight, 100);
  near(pts.inShare, 100);
  // earned / graded weight is the period's current (graded-only, D11).
  near((pts.earned / pts.gradedWeight) * 100, p.current as number);
});

test('periodPoints: ungraded categories are out of the graded weight; share is graded / total weight', () => {
  const p = projectPeriod({ key: 'p2', name: 'Finals', target: 85, categories: [
    cat({ key: 'q', weight: 36, graded: [70, 85, 90] }),
    cat({ key: 't', weight: 24, graded: [60, 90, 100], pendingNames: ['Task 4'] }),
    cat({ key: 'm', weight: 15, graded: [80], singleton: true }),
    cat({ key: 'f', weight: 25, pendingNames: ['Final Exam'], singleton: true }),
  ] });
  const pts = periodPoints(p.categories);
  near(pts.earned, 61.4, 1e-9);
  assert.equal(pts.gradedWeight, 75);
  assert.equal(pts.totalWeight, 100);
  near(pts.inShare, 75);
  near((pts.earned / pts.gradedWeight) * 100, p.current as number);
  // Not projectPeriod's item coverage (which counts the pending Task 4 against Tasks).
  assert.ok(Math.abs(p.coverage - 75) > 1);
});

test('periodPoints: nothing graded, zero weights', () => {
  const pts = periodPoints([{ n: 0, weight: 40, avg: null }, { n: 2, weight: 0, avg: 90 }]);
  assert.deepEqual(pts, { earned: 0, gradedWeight: 0, totalWeight: 40, inShare: 0 });
  assert.deepEqual(periodPoints([]), { earned: 0, gradedWeight: 0, totalWeight: 0, inShare: 0 });
});

test('rawPercent: a valid score / items pair is a percent, clamped to 0..100', () => {
  near(rawPercent('40', '50', null), 80);
  near(rawPercent(17, 20, null), 85);
  near(rawPercent('1', '3', null), 100 / 3); // full precision, not rounded
  near(rawPercent('0', '50', null), 0);
  near(rawPercent('60', '50', null), 100);
  near(rawPercent(' 45 ', '50', null), 90);
});

test('rawPercent: an incomplete or invalid pair is null', () => {
  for (const [s, i] of [['', '50'], ['40', ''], ['40', '0'], ['40', '-5'], ['-1', '50'], ['abc', '50'], ['40', 'x']]) {
    assert.equal(rawPercent(s, i, null), null, `${s}/${i}`);
  }
});

test('rawPercent: uses the transmutation table when given', () => {
  const table: TransmutationTable = { 40: { 50: 88 }, 17: { 20: 91 } };
  assert.equal(rawPercent('40', '50', table), 88);
  assert.equal(rawPercent('17', '20', table), 91);
  assert.equal(rawPercent('50', '50', table), 100); // transmute: score >= items is 100
  assert.equal(rawPercent('0', '50', table), 0);
  assert.equal(rawPercent('41', '50', table), null); // missing table cell: no override
  assert.equal(rawPercent('', '50', table), null);
});

test('whatIfOverrides: only edited, valid categories are overridden, at full precision', () => {
  const edits = {
    a: { kind: 'pct' as const, text: '87.25' },
    b: { kind: 'raw' as const, score: '1', items: '3' },
    c: { kind: 'raw' as const, score: '4', items: '' },
    d: { kind: 'pct' as const, text: '' },
    e: { kind: 'pct' as const, text: '120' },
    f: { kind: 'pct' as const, text: '-3' },
  };
  const o = whatIfOverrides(edits, null);
  assert.deepEqual(Object.keys(o).sort(), ['a', 'b', 'e', 'f']);
  assert.equal(o.a, 87.25);
  near(o.b, 100 / 3);
  assert.equal(o.e, 100);
  assert.equal(o.f, 0);
  // Raw pairs follow the table in force now (Transmute toggled after typing).
  assert.equal(whatIfOverrides({ b: { kind: 'raw', score: '40', items: '50' } }, { 40: { 50: 88 } }).b, 88);
});

test('fmtWeight: integers plain, decimals trimmed', () => {
  assert.equal(fmtWeight(40), '40');
  assert.equal(fmtWeight(12.5), '12.5');
  assert.equal(fmtWeight(33.333333), '33.33');
});
