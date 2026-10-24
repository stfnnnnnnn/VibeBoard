import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectPeriod, gradeAt, planOutcome, soloNeed, scenarios, closestReachable,
  targetPresets, outcomeTone, defaultSlotValue, subjectFinal, subjectOverall, normalizeFinalMode, scaleThresholds,
  type PeriodInput, type CategoryInput,
} from '../projection';

const near = (actual: number | null, expected: number, tol = 0.05) => {
  assert.ok(actual !== null, `expected ${expected}, got null`);
  assert.ok(Math.abs((actual as number) - expected) <= tol, `expected ${expected}±${tol}, got ${actual}`);
};
const cat = (o: Partial<CategoryInput> & Pick<CategoryInput, 'key' | 'weight'>): CategoryInput => ({
  name: o.key, color: '', graded: [], pendingNames: [], extra: 0, singleton: false, noun: 'Item', ...o,
});

// Hand-verified fixtures from mockup v4 (spec §4.5).
const MIDTERM: PeriodInput = { key: 'p1', name: 'Midterm', target: 89, categories: [
  cat({ key: 'q', weight: 36, graded: [96, 88, 92], pendingNames: ['Quiz 4: Trees'], extra: 1 }),
  cat({ key: 't', weight: 24, graded: [100], extra: 3 }),
  cat({ key: 'e', weight: 40, pendingNames: ['Midterm Exam'], singleton: true }),
] };
const FINALS: PeriodInput = { key: 'p2', name: 'Finals', target: 97, categories: [
  cat({ key: 'q', weight: 36, graded: [72, 68], pendingNames: ['Quiz 7'] }),
  cat({ key: 't', weight: 24, graded: [60, 70] }),
  cat({ key: 'e', weight: 40, pendingNames: ['Final Exam'], singleton: true }),
] };

test('midterm: need, range, current, coverage, status', () => {
  const p = projectPeriod(MIDTERM);
  near(p.need, 87.19);
  near(p.worst, 25.87);
  near(p.best, 98.27);
  near(p.current, 95.2);
  near(p.coverage, 27.6);
  assert.equal(p.remaining, 6);
  assert.equal(p.status.kind, 'stretch');
  assert.equal(p.status.tone, 'warn');
});

test('midterm: single-category what-if', () => {
  const p = projectPeriod(MIDTERM);
  near(soloNeed(p, 89, 0), 54.95);
  near(soloNeed(p, 89, 1), 63.0);
  near(soloNeed(p, 89, 2), 80.71);
});

test('midterm: every slot at the requirement lands exactly on target', () => {
  const p = projectPeriod(MIDTERM);
  const x = p.need as number;
  near(planOutcome(p, [[x, x], [x, x, x], [x]]), 89, 0.001);
  near(gradeAt(p, 70), 76.55);
});

test('midterm: scenarios swap the nearest fixed value for the requirement', () => {
  const s = scenarios(projectPeriod(MIDTERM));
  assert.deepEqual(s.map(r => r.input), [60, 70, 80, 87.2, 100]);
  near(s[3].result, 89.0, 0.06);
});

test('finals: out of reach with closest reachable letters', () => {
  const p = projectPeriod(FINALS);
  assert.ok((p.need as number) > 100);
  near(p.best, 84.4);
  near(p.current, 68.0);
  near(p.coverage, 48.0);
  assert.equal(p.status.kind, 'out-of-reach');
  const alts = closestReachable(p, 97, '4pt');
  assert.deepEqual(alts.map(a => a.label), ['C', 'D+', 'D']);
  near(alts[0].need, 91.54);
  near(alts[1].need, 81.92);
  near(alts[2].need, 72.31);
  assert.deepEqual(scenarios(p).map(r => r.input), [60, 70, 80, 90, 100]);
});

test('finals: a category with nothing left is locked for solo what-if', () => {
  assert.equal(soloNeed(projectPeriod(FINALS), 97, 1), null);
});

test('nothing graded: current is null, status still computed from need', () => {
  const p = projectPeriod({ key: 'x', name: 'X', target: 80, categories: [
    cat({ key: 'a', weight: 50, pendingNames: ['A1'] }), cat({ key: 'b', weight: 50, extra: 2 }),
  ] });
  assert.equal(p.current, null);
  near(p.need, 80);
  assert.equal(p.coverage, 0);
  assert.equal(p.status.kind, 'achievable');
});

test('everything graded: b = 0, locked in or out of reach by current', () => {
  const base = { key: 'x', name: 'X', categories: [cat({ key: 'a', weight: 100, graded: [90] })] };
  const hi = projectPeriod({ ...base, target: 85 });
  assert.equal(hi.need, null);
  assert.equal(hi.status.kind, 'locked-in');
  assert.equal(projectPeriod({ ...base, target: 95 }).status.kind, 'out-of-reach');
});

test('no items at all: empty status', () => {
  const p = projectPeriod({ key: 'x', name: 'X', target: 85, categories: [cat({ key: 'a', weight: 100 })] });
  assert.equal(p.current, null);
  assert.equal(p.status.kind, 'empty');
});

test('inactive categories are excluded and weights renormalize', () => {
  const p = projectPeriod({ key: 'x', name: 'X', target: 85, categories: [
    cat({ key: 'a', weight: 60, graded: [80], extra: 1 }), cat({ key: 'b', weight: 40 }),
  ] });
  assert.equal(p.categories[1].share, 0);
  near(p.categories[0].share, 1);
  near(p.need, 90);
});

test('negative need means locked in; extra on a singleton is ignored', () => {
  const p = projectPeriod({ key: 'x', name: 'X', target: 40, categories: [
    cat({ key: 'a', weight: 90, graded: [100] }), cat({ key: 'e', weight: 10, singleton: true, pendingNames: ['E'], extra: 5 }),
  ] });
  assert.equal(p.categories[1].k, 1);
  assert.ok((p.need as number) <= 0);
  assert.equal(p.status.kind, 'locked-in');
});

test('defaultSlotValue clamps to 0..100 and rounds to one decimal', () => {
  assert.equal(defaultSlotValue(projectPeriod(MIDTERM)), 87.2);
  assert.equal(defaultSlotValue(projectPeriod(FINALS)), 100);
});

test('defaultSlotValue when locked in: holds the current average, not 0', () => {
  const p = projectPeriod({ key: 'x', name: 'X', target: 70, categories: [
    cat({ key: 'a', weight: 60, graded: [98, 96], pendingNames: ['A3'] }), cat({ key: 'b', weight: 40, graded: [92.34] }),
  ] });
  assert.ok((p.need as number) <= 0);
  assert.equal(p.status.kind, 'locked-in');
  assert.equal(defaultSlotValue(p), 95.1); // round1(0.6 * 97 + 0.4 * 92.34) = round1(95.136)
});

test('outcomeTone thresholds', () => {
  assert.equal(outcomeTone(0), 'success');
  assert.equal(outcomeTone(-0.04), 'success');
  assert.equal(outcomeTone(-1.7), 'warn');
  assert.equal(outcomeTone(-3.5), 'danger');
});

test('presets and thresholds per scale', () => {
  assert.deepEqual(targetPresets('4pt').map(p => p.value), [97, 93, 89, 85, 80, 70]);
  assert.deepEqual(targetPresets('1pt').map(p => p.label), ['1.00', '1.50', '2.00', '2.50', '3.00']);
  assert.deepEqual(scaleThresholds(null).map(t => t.min), [90, 80, 70, 60]);
});

test('final grade: period, average, none', () => {
  near(subjectFinal([MIDTERM, FINALS], 'period', 'p2'), 68.0);
  near(subjectFinal([MIDTERM, FINALS], 'average', null), 81.6);
  assert.equal(subjectFinal([MIDTERM, FINALS], null, null), null);
  assert.equal(subjectFinal([MIDTERM, FINALS], 'period', 'nope'), null);
  near(subjectOverall([MIDTERM, FINALS], null, null), 81.6);
  near(subjectOverall([MIDTERM, FINALS], 'period', 'p2'), 68.0);
});

test('normalizeFinalMode maps legacy collective to average, unknown to null', () => {
  assert.equal(normalizeFinalMode('period'), 'period');
  assert.equal(normalizeFinalMode('average'), 'average');
  assert.equal(normalizeFinalMode('collective'), 'average');
  assert.equal(normalizeFinalMode('bogus'), null);
  assert.equal(normalizeFinalMode(null), null);
  assert.equal(normalizeFinalMode(undefined), null);
});
