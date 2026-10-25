import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestBankTarget, suggestLegacyTarget, extractAnnouncementNote, noteSpans, stripHtml, classificationText,
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

/* F6: Canvas sends HTML. stripHtml decodes entities and keeps paragraph breaks as '\n', and note_spans (server) and
   the reading pane (client) both run on its output, so the highlight still lines up. */
test('stripHtml decodes named and numeric entities', () => {
  assert.equal(stripHtml('<p>Hi&nbsp; iTams</p>'), 'Hi iTams');
  assert.equal(stripHtml('&nbsp; Miss Gelai'), 'Miss Gelai');
  assert.equal(stripHtml('A &amp; B &lt;3 &gt; &quot;q&quot; it&#39;s it&apos;s'), 'A & B <3 > "q" it\'s it\'s');
  assert.equal(stripHtml('caf&#233; &#x2014; &#X41;&#8217;s'), 'café — A’s');
  assert.equal(stripHtml('3&ndash;5 &mdash; &lsquo;a&rsquo; &ldquo;b&rdquo;&hellip;'), '3–5 — ‘a’ “b”…');
  // Decoding happens after tags are removed, so an escaped tag stays text; unknown or invalid entities stay as written.
  assert.equal(stripHtml('&lt;b&gt;bold&lt;/b&gt;'), '<b>bold</b>');
  assert.equal(stripHtml('&copy; &#0; &#x110000; &amp;nbsp;'), '&copy; &#0; &#x110000; &nbsp;');
  assert.equal(stripHtml('a&#160;&#160;b'), 'a b');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml('<p>&nbsp;</p>'), '');
});

test('stripHtml turns block tags into line breaks and collapses the rest', () => {
  assert.equal(stripHtml('<p>Good day class</p><p>Bring your ID</p>'), 'Good day class\nBring your ID');
  assert.equal(stripHtml('Line one<br>Line two<br/>Line three<BR />end'), 'Line one\nLine two\nLine three\nend');
  assert.equal(stripHtml('<h2>Title</h2><ul><li>one</li><li>two</li></ul><div>after</div>'), 'Title\none\ntwo\nafter');
  assert.equal(stripHtml('<p>a   <strong>b</strong>\n\n  c</p>\n\n<p></p><p>  d </p>'), 'a b c\nd');
  assert.equal(stripHtml('<span>in</span><span>line</span>'), 'in line');
});

test('note spans line up with the decoded, line-broken body', () => {
  const html = '<p>Hi&nbsp; class</p><p>Bring a calculator</p><p>Coverage: trees &amp; graphs</p><p>See you!</p>';
  const body = stripHtml(html);
  assert.equal(body, 'Hi class\nBring a calculator\nCoverage: trees & graphs\nSee you!');
  // Unpunctuated paragraph lines are their own sentences now.
  assert.deepEqual(noteSpans(body).map(([s, e]) => body.slice(s, e)), ['Bring a calculator', 'Coverage: trees & graphs']);
  assert.equal(extractAnnouncementNote(body), 'Bring a calculator Coverage: trees & graphs');
  assert.ok(!extractAnnouncementNote(body).includes('&'.concat('amp;')));
  assert.equal(classificationText('Quiz', html), `Quiz ${body}`);
});
