import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GradingPresetFull } from '@/lib/studypulse/types';
import {
  toDraft, linkAcross, renameLinked, periodSum, validateDraft, draftToPayload,
  feuTemplate, blankDraft, deletedCategories, prefillMap, describeChanges, stepOfError, setSingleton, type UiCategory,
} from '../draft';

const PRESET: GradingPresetFull = {
  preset_id: 7, name: 'FEU Tech Standard', is_default: 0, has_lab: 0, lec_weight: 100, lab_weight: 0,
  grade_scale: '4pt', final_period_id: 21, final_mode: 'period',
  periods: [
    { period_id: 21, name: 'Finals', sort_order: 1, categories: [
      { cat_id: 104, name: 'Quizzes', weight: 36, is_singleton: 0, sort_order: 0, link_group: 'q', carry_score: 1, include_earlier: 1 },
      { cat_id: 105, name: 'Tasks', weight: 24, is_singleton: 0, sort_order: 1, link_group: null, carry_score: 1, include_earlier: 0 },
      { cat_id: 106, name: 'Midterm Exam', weight: 15, is_singleton: 1, sort_order: 2, link_group: 'me', carry_score: 1, include_earlier: 0 },
      { cat_id: 107, name: 'Final Exam', weight: 25, is_singleton: 1, sort_order: 3, link_group: null, carry_score: 1, include_earlier: 0 },
    ] },
    { period_id: 20, name: 'Midterm', sort_order: 0, categories: [
      { cat_id: 102, name: 'Tasks', weight: 24, is_singleton: 0, sort_order: 1, link_group: null, carry_score: 1, include_earlier: 0 },
      { cat_id: 101, name: 'Quizzes', weight: '36.00' as unknown as number, is_singleton: 0, sort_order: 0, link_group: 'q', carry_score: 1, include_earlier: 0 },
      { cat_id: 103, name: 'Midterm Exam', weight: 40, is_singleton: 1, sort_order: 2, link_group: 'me', carry_score: 0, include_earlier: 0 },
    ] },
  ],
};

const strip = (d: ReturnType<typeof toDraft>) => draftToPayload(d);

test('toDraft orders periods and categories, coerces flags and weights, and finds the final period index', () => {
  const d = toDraft(PRESET);
  assert.equal(d.name, 'FEU Tech Standard');
  assert.equal(d.grade_scale, '4pt');
  assert.equal(d.final_mode, 'period');
  assert.equal(d.final_period_index, 1);
  assert.deepEqual(d.periods.map(p => p.name), ['Midterm', 'Finals']);
  assert.deepEqual(d.periods[0].categories.map(c => c.name), ['Quizzes', 'Tasks', 'Midterm Exam']);
  const q = d.periods[0].categories[0];
  assert.equal(q.weight, 36);
  assert.equal(q.cat_id, 101);
  assert.equal(q.is_singleton, false);
  assert.equal(d.periods[0].categories[2].carry_score, false);
  assert.equal(d.periods[1].categories[0].include_earlier, true);
  // Every period and category gets a distinct client key.
  const keys = d.periods.flatMap(p => [p.key, ...p.categories.map(c => c.key)]);
  assert.equal(new Set(keys).size, keys.length);
});

test('toDraft -> draftToPayload round trip keeps ids and values and drops client keys', () => {
  const body = strip(toDraft(PRESET));
  assert.deepEqual(body, {
    name: 'FEU Tech Standard', grade_scale: '4pt', final_mode: 'period', final_period_index: 1,
    periods: [
      { period_id: 20, name: 'Midterm', categories: [
        { cat_id: 101, name: 'Quizzes', weight: 36, is_singleton: false, link_group: 'q', carry_score: true, include_earlier: false },
        { cat_id: 102, name: 'Tasks', weight: 24, is_singleton: false, link_group: null, carry_score: true, include_earlier: false },
        { cat_id: 103, name: 'Midterm Exam', weight: 40, is_singleton: true, link_group: 'me', carry_score: false, include_earlier: false },
      ] },
      { period_id: 21, name: 'Finals', categories: [
        { cat_id: 104, name: 'Quizzes', weight: 36, is_singleton: false, link_group: 'q', carry_score: true, include_earlier: true },
        { cat_id: 105, name: 'Tasks', weight: 24, is_singleton: false, link_group: null, carry_score: true, include_earlier: false },
        { cat_id: 106, name: 'Midterm Exam', weight: 15, is_singleton: true, link_group: 'me', carry_score: true, include_earlier: false },
        { cat_id: 107, name: 'Final Exam', weight: 25, is_singleton: true, link_group: null, carry_score: true, include_earlier: false },
      ] },
    ],
  });
});

test('draftToPayload trims names', () => {
  const d = toDraft(PRESET);
  d.name = '  Mine  ';
  d.periods[0].name = ' Midterm ';
  d.periods[0].categories[0].name = ' Quizzes ';
  const body = draftToPayload(d);
  assert.equal(body.name, 'Mine');
  assert.equal(body.periods[0].name, 'Midterm');
  assert.equal(body.periods[0].categories[0].name, 'Quizzes');
});

test('linkAcross adds exactly one mirrored category to every other period', () => {
  const d = blankDraft();
  d.periods = [
    { key: 'a', name: 'Prelim', categories: [{ key: 'a1', name: 'Labs', weight: 100, is_singleton: false, link_group: null, carry_score: true, include_earlier: false }] },
    { key: 'b', name: 'Midterm', categories: [{ key: 'b1', name: 'Exam', weight: 100, is_singleton: true, link_group: null, carry_score: true, include_earlier: false }] },
    { key: 'c', name: 'Finals', categories: [{ key: 'c1', name: 'Exam', weight: 100, is_singleton: true, link_group: null, carry_score: true, include_earlier: false }] },
  ];
  const once = linkAcross(d, 0, 0, true);
  const g = once.periods[0].categories[0].link_group;
  assert.ok(g && g.length <= 40);
  for (const pi of [1, 2]) {
    const mirrors: UiCategory[] = once.periods[pi].categories.filter(c => c.link_group === g);
    assert.equal(mirrors.length, 1);
    assert.equal(mirrors[0].name, 'Labs');
    assert.equal(mirrors[0].is_singleton, false);
    assert.equal(mirrors[0].cat_id, undefined);
    assert.equal(once.periods[pi].categories.length, 2);
  }
  // Linking again (or from a mirror) never adds a second one.
  const twice = linkAcross(once, 2, 1, true);
  assert.deepEqual(twice.periods.map(p => p.categories.length), [1, 2, 2]);
  // Input is not mutated.
  assert.equal(d.periods[1].categories.length, 1);
});

test('linkAcross adopts an existing unlinked category with the same name instead of duplicating it', () => {
  const d = toDraft(PRESET);
  // Tasks (unlinked) exists in both periods.
  const out = linkAcross(d, 0, 1, true);
  const g = out.periods[0].categories[1].link_group;
  assert.ok(g);
  assert.equal(out.periods[1].categories.length, 4);
  assert.equal(out.periods[1].categories[1].link_group, g);
  assert.equal(out.periods[1].categories[1].cat_id, 105);
});

test('linkAcross off unlinks the whole group and clears include_earlier', () => {
  const d = toDraft(PRESET);
  const out = linkAcross(d, 1, 0, false);
  assert.equal(out.periods[0].categories[0].link_group, null);
  assert.equal(out.periods[1].categories[0].link_group, null);
  assert.equal(out.periods[1].categories[0].include_earlier, false);
  assert.equal(out.periods[1].categories.length, 4); // the categories themselves stay
});

test('renameLinked renames every category in the group and nothing else', () => {
  const d = toDraft(PRESET);
  const out = renameLinked(d, 1, 0, 'Short Quizzes');
  assert.equal(out.periods[0].categories[0].name, 'Short Quizzes');
  assert.equal(out.periods[1].categories[0].name, 'Short Quizzes');
  assert.equal(out.periods[0].categories[1].name, 'Tasks');
  const solo = renameLinked(d, 0, 1, 'Seatwork');
  assert.equal(solo.periods[0].categories[1].name, 'Seatwork');
  assert.equal(solo.periods[1].categories[1].name, 'Tasks');
});

test('periodSum adds weights without float noise', () => {
  const d = toDraft(PRESET);
  assert.equal(periodSum(d.periods[0]), 100);
  d.periods[0].categories[0].weight = 33.3;
  d.periods[0].categories[1].weight = 33.3;
  d.periods[0].categories[2].weight = 33.4;
  assert.equal(periodSum(d.periods[0]), 100);
});

test('validateDraft passes a valid draft', () => {
  assert.deepEqual(validateDraft(toDraft(PRESET)), {});
  assert.deepEqual(validateDraft(feuTemplate()), {});
});

test('validateDraft flags a weight sum that is not 100', () => {
  const d = toDraft(PRESET);
  d.periods[1].categories[3].weight = 20;
  const e = validateDraft(d);
  assert.match(e['p1.sum'], /95/);
  assert.equal(Object.keys(e).length, 1);
});

test('validateDraft flags empty names on the field that is empty', () => {
  const d = toDraft(PRESET);
  d.name = ' ';
  d.periods[0].name = '';
  d.periods[1].categories[2].name = '  ';
  const e = validateDraft(d);
  assert.ok(e.name);
  assert.ok(e['p0.name']);
  assert.ok(e['p1.c2.name']);
});

test('validateDraft flags a bad weight, two categories of one group in a period, and a missing final period', () => {
  const d = toDraft(PRESET);
  d.periods[0].categories[1].weight = 120;
  d.periods[0].categories[1].link_group = 'q';
  d.final_period_index = null;
  const e = validateDraft(d);
  assert.ok(e['p0.c1.weight']);
  assert.ok(e['p0.c1.group']);
  assert.equal(e.final, 'Pick the period that shows the final grade');
});

test('stepOfError maps field keys onto the five steps', () => {
  assert.equal(stepOfError('name'), 0);
  assert.equal(stepOfError('p1.c2.name'), 1);
  assert.equal(stepOfError('p0.sum'), 1);
  assert.equal(stepOfError('final'), 2);
  assert.equal(stepOfError('form'), 4);
});

test('feuTemplate is the FEU default: Midterm Exam linked into Finals as a single score', () => {
  const t = feuTemplate();
  assert.deepEqual(t.periods.map(p => p.categories.map(c => [c.name, c.weight, c.is_singleton])), [
    [['Quizzes', 36, false], ['Tasks', 24, false], ['Midterm Exam', 40, true]],
    [['Quizzes', 36, false], ['Tasks', 24, false], ['Midterm Exam', 15, true], ['Final Exam', 25, true]],
  ]);
  const g = t.periods[0].categories[2].link_group;
  assert.ok(g);
  assert.equal(t.periods[1].categories[2].link_group, g);
  assert.equal(t.periods[0].categories[0].link_group, null);
});

test('deletedCategories lists categories of the preset that are no longer in the draft', () => {
  const d = toDraft(PRESET);
  d.periods[1].categories.splice(1, 1); // Finals Tasks
  assert.deepEqual(deletedCategories(PRESET, d).map(c => [c.cat_id, c.name, c.period]), [[105, 'Tasks', 'Finals']]);
});

test('prefillMap pairs by period name and category name, then by category name, else leaves it unpicked', () => {
  const next: GradingPresetFull = { ...PRESET, preset_id: 9, periods: [
    { period_id: 30, name: 'midterm', sort_order: 0, categories: [
      { cat_id: 201, name: 'quizzes', weight: 50, is_singleton: 0, sort_order: 0, link_group: null, carry_score: 1, include_earlier: 0 },
      { cat_id: 202, name: 'Exam', weight: 50, is_singleton: 1, sort_order: 1, link_group: null, carry_score: 1, include_earlier: 0 },
    ] },
    { period_id: 31, name: 'Finals', sort_order: 1, categories: [
      { cat_id: 203, name: 'Tasks', weight: 100, is_singleton: 0, sort_order: 0, link_group: null, carry_score: 1, include_earlier: 0 },
    ] },
  ] };
  const m = prefillMap(PRESET, next, { 101: 2, 102: 1, 103: 1, 104: 3 });
  assert.deepEqual(m, { 101: 201, 102: 203, 103: '', 104: 201 });
});

test('describeChanges lists what the review step shows', () => {
  const d = toDraft(PRESET);
  d.grade_scale = '1pt';
  d.periods[0].categories[0].weight = 30;
  d.periods[0].categories[1].weight = 30;
  d.periods[1].categories.splice(1, 1);
  d.periods[1].categories[0].weight = 60;
  d.periods[1].categories.push({ key: 'n', name: 'Recitation', weight: 0, is_singleton: false, link_group: null, carry_score: true, include_earlier: false });
  const lines = describeChanges(PRESET, d);
  assert.ok(lines.some(l => /1\.0/.test(l)));
  assert.ok(lines.some(l => /Midterm · Quizzes/.test(l) && /36/.test(l) && /30/.test(l)));
  assert.ok(lines.some(l => /Removed/.test(l) && /Finals · Tasks/.test(l)));
  assert.ok(lines.some(l => /Added/.test(l) && /Finals · Recitation/.test(l)));
  assert.deepEqual(describeChanges(PRESET, toDraft(PRESET)), []);
});

test('setSingleton mirrors the single-score flag to every category in the link group (R11)', () => {
  const d = toDraft(PRESET);
  // Quizzes is linked ('q') in both periods; Finals' copy includes earlier entries.
  const single = setSingleton(d, 0, 0, true);
  assert.equal(single.periods[0].categories[0].is_singleton, true);
  assert.equal(single.periods[1].categories[0].is_singleton, true);
  assert.equal(single.periods[1].categories[0].include_earlier, false); // only a multi-entry flag
  assert.equal(single.periods[0].categories[1].is_singleton, false); // Tasks untouched
  const back = setSingleton(single, 1, 0, false);
  assert.deepEqual(back.periods.map(p => p.categories[0].is_singleton), [false, false]);
  // An unlinked category changes alone.
  const solo = setSingleton(d, 1, 3, false);
  assert.equal(solo.periods[1].categories[3].is_singleton, false);
  assert.equal(solo.periods[0].categories[2].is_singleton, true);
  // The input is not mutated.
  assert.equal(d.periods[1].categories[0].is_singleton, false);
});
