import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entryHasGrade, entryValue, nounFor, buildCustomPeriods, buildLegacyPeriods, legacyMidtermPeriod, averageOf,
} from '../periodModel';
import { projectPeriod } from '../projection';
import { EMPTY_PREFS } from '../prefs';
import type { EntryRow, PresetLike } from '../types';

const row = (o: Partial<EntryRow>): EntryRow => ({
  id: 1, name: 'x', specificType: '', urgency: 'Low', status: 'Pending', deadline: '', accomplished_at: '',
  score: '', items: '', grade: null, ...o,
});

const PRESET: PresetLike = {
  final_mode: 'average', final_period_id: null,
  periods: [
    { period_id: 1, name: 'Midterm', sort_order: 0, categories: [
      { cat_id: 10, name: 'Quizzes', weight: 36, is_singleton: 0, sort_order: 0, link_group: null, carry_score: 1, include_earlier: 0 },
      { cat_id: 11, name: 'Tasks', weight: 24, is_singleton: 0, sort_order: 1, link_group: null, carry_score: 1, include_earlier: 0 },
      { cat_id: 12, name: 'Midterm Exam', weight: 40, is_singleton: 1, sort_order: 2, link_group: 'lg-1', carry_score: 1, include_earlier: 0 },
    ] },
    { period_id: 2, name: 'Finals', sort_order: 1, categories: [
      { cat_id: 20, name: 'Quizzes', weight: 36, is_singleton: 0, sort_order: 0, link_group: null, carry_score: 1, include_earlier: 0 },
      { cat_id: 22, name: 'Midterm Exam', weight: 15, is_singleton: 1, sort_order: 1, link_group: 'lg-1', carry_score: 1, include_earlier: 0 },
    ] },
  ],
};

test('entryHasGrade / entryValue', () => {
  assert.equal(entryHasGrade(row({ grade: 90 })), true);
  assert.equal(entryHasGrade(row({ score: '8', items: '10' })), true);
  assert.equal(entryHasGrade(row({})), false);
  assert.equal(entryValue(row({ grade: 90 }), null), 90);
  assert.equal(entryValue(row({ score: '8', items: '10' }), null), 80);
  // transmutation table: score 8 of max 10 -> 85
  assert.equal(entryValue(row({ score: '8', items: '10', grade: 80 }), { 8: { 10: 85 } }), 85);
});

test('nounFor', () => {
  assert.equal(nounFor('Quizzes'), 'Quiz');
  assert.equal(nounFor('Activities'), 'Activity');
  assert.equal(nounFor('Tasks'), 'Task');
  assert.equal(nounFor('Midterm Exam'), 'Midterm Exam');
  assert.equal(nounFor('Class'), 'Class');
});

test('custom periods: keys, colours, pending names, extras, targets', () => {
  const periods = buildCustomPeriods(PRESET, {
    10: [row({ grade: 96 }), row({ grade: 88 }), row({ name: 'Quiz 3', grade: null })],
    11: [],
    12: [],
  }, { extras: { c11: 3, c12: 4 }, targets: { p1: 89 } }, null);
  const mid = periods[0];
  assert.equal(mid.key, 'p1');
  assert.equal(mid.target, 89);
  assert.equal(periods[1].target, 85);
  assert.deepEqual(mid.categories.map(c => c.key), ['c10', 'c11', 'c12']);
  assert.deepEqual(mid.categories[0].pendingNames, ['Quiz 3']);
  assert.equal(mid.categories[1].extra, 3);
  assert.equal(mid.categories[1].noun, 'Task');
  // empty singleton is one implicit remaining item named after the category; extra ignored
  assert.deepEqual(mid.categories[2].pendingNames, ['Midterm Exam']);
  assert.equal(mid.categories[2].extra, 0);
  assert.notEqual(mid.categories[0].color, mid.categories[1].color);
});

test('linked carry singleton borrows the first scored sibling', () => {
  const periods = buildCustomPeriods(PRESET, { 10: [], 11: [], 12: [row({ grade: 82 })], 20: [], 22: [] }, EMPTY_PREFS, null);
  const fin = periods[1].categories[1];
  assert.deepEqual(fin.graded, [82]);
  assert.deepEqual(fin.pendingNames, []);
});

test('legacy: all graded equals the old finals formula', () => {
  const [overall] = buildLegacyPeriods(
    [row({ grade: 90 })], [row({ grade: 80 })],
    [row({ grade: 70, specificType: 'Midterm' }), row({ grade: 60, specificType: 'Final Exam' })],
    EMPTY_PREFS, null,
  );
  assert.equal(overall.key, 'overall');
  const cur = projectPeriod(overall).current as number;
  assert.ok(Math.abs(cur - 75.9) < 1e-9, String(cur)); // (24·90 + 36·80 + 15·70 + 25·60) / 100
});

test('legacy: missing exams are implicit remaining items; midterm view re-weights to 40', () => {
  const [overall] = buildLegacyPeriods([row({ grade: 90 })], [], [], EMPTY_PREFS, null);
  assert.deepEqual(overall.categories.map(c => c.key), ['legacy-activities', 'legacy-quizzes', 'legacy-midterm', 'legacy-final']);
  assert.deepEqual(overall.categories[2].pendingNames, ['Midterm Exam']);
  const mid = legacyMidtermPeriod(overall);
  assert.deepEqual(mid.categories.map(c => [c.key, c.weight]), [['legacy-activities', 24], ['legacy-quizzes', 36], ['legacy-midterm', 40]]);
});

test('averageOf', () => {
  assert.equal(averageOf([row({ grade: 90 }), row({ grade: 80 }), row({})], null), 85);
  assert.equal(averageOf([row({})], null), null);
});
