import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestBankTarget, suggestLegacyTarget, extractAnnouncementNote, noteSpans,
} from '../classify';

function period(period_id: number, name: string, cats: string[]) {
  return { period_id, name, categories: cats.map((n, i) => ({ cat_id: period_id * 100 + i + 1, name: n })) };
}

const STD = [period(1, 'Prelims', ['Quizzes', 'Tasks', 'Midterm Exam']), period(2, 'Midterms', ['Quizzes', 'Tasks', 'Midterm Exam'])];

test('suggestBankTarget: quiz title goes to Quizzes (match)', () => {
  const s = suggestBankTarget('Quiz 4: Binary Search Trees', STD, null)!;
  assert.equal(s.cat_name, 'Quizzes');
  assert.equal(s.confidence, 'match');
});

test('suggestBankTarget: data sheet lab report goes to Tasks via alias', () => {
  const s = suggestBankTarget('[M7S2-DATA SHEET] Hash Tables Lab Report', STD, null)!;
  assert.equal(s.cat_name, 'Tasks');
  assert.equal(s.cat_id, 102);
  assert.equal(s.confidence, 'match');
  assert.match(s.reason, /^“data sheet” matches your Tasks category\./);
});

test('suggestBankTarget: problem set matches the category name exactly', () => {
  const s = suggestBankTarget('Problem Set 6: Graph Coloring', [period(1, 'Prelims', ['Quizzes', 'Problem Sets', 'Midterm Exam'])], null)!;
  assert.equal(s.cat_name, 'Problem Sets');
  assert.equal(s.confidence, 'match');
  assert.match(s.reason, /^“Problem Sets” matches the category name\./);
});

test('suggestBankTarget: seatwork alias lands in Quizzes', () => {
  const s = suggestBankTarget('Seatwork: Euler Paths', [period(1, 'Prelims', ['Quizzes', 'Problem Sets'])], null)!;
  assert.equal(s.cat_name, 'Quizzes');
  assert.equal(s.confidence, 'match');
  assert.match(s.reason, /^“seatwork” matches your Quizzes category\./);
});

test('suggestBankTarget: no match falls back to the first category as a guess', () => {
  const s = suggestBankTarget('Survey', [period(1, 'Prelims', ['Quizzes', 'Tasks'])], null)!;
  assert.equal(s.cat_name, 'Quizzes');
  assert.equal(s.confidence, 'guess');
  assert.match(s.reason, /^No category matched “Survey”, so this is a guess\. Check it with Change…/);
});

test('suggestBankTarget: period is the recent one, else the first', () => {
  const recent = suggestBankTarget('Quiz 1', STD, 2)!;
  assert.equal(recent.period_id, 2);
  assert.equal(recent.period_name, 'Midterms');
  assert.equal(recent.cat_id, 201);
  assert.ok(recent.reason.endsWith('Midterms is the period you’re currently adding entries to.') ||
            recent.reason.endsWith("Midterms is the period you're currently adding entries to."));
  const first = suggestBankTarget('Quiz 1', STD, null)!;
  assert.equal(first.period_id, 1);
  assert.ok(first.reason.endsWith('Prelims is the first period.'));
  const stale = suggestBankTarget('Quiz 1', STD, 99)!;
  assert.equal(stale.period_id, 1);
});

test('suggestBankTarget: null when there are no periods', () => {
  assert.equal(suggestBankTarget('Quiz 1', [], null), null);
});

test('suggestLegacyTarget', () => {
  assert.deepEqual(
    [suggestLegacyTarget('Quiz 3').target, suggestLegacyTarget('Quiz 3').confidence],
    ['quizzes', 'match'],
  );
  assert.deepEqual(
    [suggestLegacyTarget('Final Exam').target, suggestLegacyTarget('Final Exam').confidence],
    ['exams', 'match'],
  );
  const survey = suggestLegacyTarget('Survey');
  assert.equal(survey.target, 'activities');
  assert.equal(survey.confidence, 'guess');
  assert.ok(survey.reason.length > 0);
});

const BODY = 'Reminder: our long quiz is on Monday, Nov 3, during class hours. Coverage: graph traversal, trees, and coloring. Bring a calculator.';

test('extractAnnouncementNote keeps the extra-detail sentences', () => {
  assert.equal(extractAnnouncementNote(BODY), 'Coverage: graph traversal, trees, and coloring. Bring a calculator.');
});

test('noteSpans returns the ranges of those sentences', () => {
  const spans = noteSpans(BODY);
  assert.equal(spans.length, 2);
  assert.deepEqual(spans.map(([s, e]) => BODY.slice(s, e)), [
    'Coverage: graph traversal, trees, and coloring.',
    'Bring a calculator.',
  ]);
});

test('no cues: empty note and no spans', () => {
  const plain = 'Class is moved to Room 204 on Friday. See you there!';
  assert.equal(extractAnnouncementNote(plain), '');
  assert.deepEqual(noteSpans(plain), []);
  assert.equal(extractAnnouncementNote(''), '');
});

test('cues are case-insensitive, sentence-initial and whole-word', () => {
  const body = "please BRING your ID. Don't forget the form! Notebooks are optional. We will note attendance.";
  assert.equal(extractAnnouncementNote(body), "please BRING your ID. Don't forget the form!");
});
