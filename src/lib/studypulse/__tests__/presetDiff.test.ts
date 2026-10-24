import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPreset, validateMoves, survivingPositions, type DraftPeriod } from '../presetDiff';
import { validateDraft, resolveFinal, linkGroupError } from '../presetDiff';

const OLD = { periods: [
  { period_id: 1, categories: [{ cat_id: 10 }, { cat_id: 11 }] },
  { period_id: 2, categories: [{ cat_id: 20 }] },
] };
const cat = (o: Partial<import('../presetDiff').DraftCategory>) => ({ name: 'X', weight: 50, is_singleton: false, link_group: null, carry_score: true, include_earlier: false, ...o });

test('keeps ids for edits, inserts new, deletes removed', () => {
  const draft: DraftPeriod[] = [
    { period_id: 1, name: 'Midterm', categories: [cat({ cat_id: 10, name: 'Quizzes', weight: 60 }), cat({ name: 'Labs', weight: 40 })] },
    { name: 'Finals', categories: [cat({ name: 'Quizzes', weight: 100 })] },
  ];
  const d = diffPreset(OLD, draft);
  assert.deepEqual(d.periodUpdates.map(p => p.period_id), [1]);
  assert.deepEqual(d.periodInserts.map(p => p.name), ['Finals']);
  assert.deepEqual(d.periodDeletes, [2]);
  assert.deepEqual(d.catUpdates.map(c => c.cat_id), [10]);
  assert.equal(d.catInserts.length, 2);
  assert.deepEqual(d.catDeletes.sort(), [11, 20]);
});

test('a deleted category with entries needs a move', () => {
  assert.throws(() => validateMoves([11], { 11: 3 }, {}), /missing-move:11/);
  assert.doesNotThrow(() => validateMoves([11], { 11: 3 }, { 11: { to: 10 } }));
  assert.doesNotThrow(() => validateMoves([11], { 11: 3 }, { 11: 'delete' }));
  assert.doesNotThrow(() => validateMoves([20], { 20: 0 }, {}));
});

test('surviving positions for copy remap', () => {
  const draft: DraftPeriod[] = [{ period_id: 1, name: 'M', categories: [cat({ cat_id: 11 }), cat({ cat_id: 10 })] }];
  assert.deepEqual(survivingPositions(draft), { 11: [0, 0], 10: [0, 1] });
});

/* Additions beyond the brief: guards the routes rely on. */

test('ids from outside the old preset are inserts; a kept category in a new period gets period_id 0', () => {
  const draft: DraftPeriod[] = [
    { period_id: 1, name: 'M', categories: [cat({ cat_id: 999, weight: 100 })] },
    { period_id: 77, name: 'F', categories: [cat({ cat_id: 11, weight: 100 })] },
  ];
  const d = diffPreset(OLD, draft);
  assert.deepEqual(d.periodInserts.map(p => p.index), [1]);
  assert.deepEqual(d.catInserts.map(c => c.periodIndex), [0]);
  assert.deepEqual(d.catUpdates, [{ cat_id: 11, period_id: 0, periodIndex: 1, fields: draft[1].categories[0], sort_order: 0 }]);
  assert.deepEqual(d.catDeletes.sort(), [10, 20]);
});

test('an id used twice in the draft throws', () => {
  assert.throws(() => diffPreset(OLD, [{ period_id: 1, name: 'M', categories: [cat({ cat_id: 10 }), cat({ cat_id: 10 })] }]), /duplicate-id/);
  assert.throws(() => diffPreset(OLD, [{ period_id: 1, name: 'M', categories: [] }, { period_id: 1, name: 'F', categories: [] }]), /duplicate-id/);
});

test('a move must target a kept category when survivors are given', () => {
  assert.throws(() => validateMoves([11], { 11: 1 }, { 11: { to: 20 } }, new Set([10])), /bad-move-target:11/);
  assert.doesNotThrow(() => validateMoves([11], { 11: 1 }, { 11: { to: 10 } }, new Set([10])));
  assert.throws(() => validateMoves([11], { 11: 1 }, { 11: { to: 'x' } as unknown as { to: number } }), /missing-move:11/);
});

test('validateDraft: names, sums, link groups', () => {
  const ok: DraftPeriod[] = [{ name: 'M', categories: [cat({ weight: 60 }), cat({ weight: 40 })] }];
  assert.equal(validateDraft('Sys', ok), null);
  assert.match(validateDraft('', ok)!, /name/);
  assert.match(validateDraft('Sys', [])!, /at least one period/);
  assert.match(validateDraft('Sys', [{ name: ' ', categories: ok[0].categories }])!, /period needs a name/);
  assert.match(validateDraft('Sys', [{ name: 'M', categories: [cat({ weight: 60 })] }])!, /add up to 100/);
  assert.match(validateDraft('Sys', [{ name: 'M', categories: [cat({ name: '', weight: 100 })] }])!, /needs a name/);
  assert.equal(validateDraft('Sys', [{ name: 'M', categories: [cat({ link_group: 'g', weight: 50 }), cat({ link_group: 'g', weight: 50 })] }]),
    'A period can only have one category per linked group');
});

test('resolveFinal follows ruling R8', () => {
  const ids = [101, 102];
  assert.deepEqual(resolveFinal('period', null, 1, null, ids), { final_mode: 'period', final_period_id: 102 });
  assert.deepEqual(resolveFinal('period', null, 5, null, ids), { error: 'Pick the period that shows the final grade' });
  assert.deepEqual(resolveFinal('average', null, 9, null, ids), { final_mode: 'average', final_period_id: null });
  assert.deepEqual(resolveFinal('average', null, 0, null, ids), { final_mode: 'average', final_period_id: 101 });
  assert.deepEqual(resolveFinal('collective', null, 0, null, ids), { final_mode: 'average', final_period_id: 101 });
  // Mode not sent: keep the stored one; its period was deleted (no fallback) -> NULL/NULL, no error.
  assert.deepEqual(resolveFinal(undefined, 'period', undefined, null, ids), { final_mode: null, final_period_id: null });
  assert.deepEqual(resolveFinal(undefined, 'period', undefined, 1, ids), { final_mode: 'period', final_period_id: 102 });
  assert.deepEqual(resolveFinal(null, 'period', 0, null, ids), { final_mode: null, final_period_id: null });
  assert.deepEqual(resolveFinal('bogus', null, 0, null, ids), { error: 'Unknown final grade rule' });
});

test('linkGroupError: one category per linked group per period (shared by PUT and POST /grading)', () => {
  const msg = 'A period can only have one category per linked group';
  assert.equal(linkGroupError([{ categories: [{ link_group: 'g' }, { link_group: 'g' }] }]), msg);
  assert.equal(linkGroupError([{ categories: [{ link_group: 'g' }] }, { categories: [{ link_group: 'g' }] }]), null);
  assert.equal(linkGroupError([{ categories: [{ link_group: null }, { link_group: null }, { link_group: '' }, { link_group: '' }] }]), null);
  assert.equal(linkGroupError([{ categories: [{ link_group: 'a' }, { link_group: 'b' }] }]), null);
  assert.equal(linkGroupError([{ categories: [{ link_group: 'x'.repeat(41) }] }]), 'Invalid linked group');
  assert.equal(linkGroupError([{}, null]), null);
});
