import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortCourseCode } from '../courseCode';

test('extracts the course segment from a section code', () => {
  assert.equal(shortCourseCode('3TSY2526_CS0061L_TN3'), 'CS0061L');
});
test('keeps an already-short code', () => {
  assert.equal(shortCourseCode('CS0001'), 'CS0001');
  assert.equal(shortCourseCode('EE205'), 'EE205');
});
test('falls back to the full code when no segment matches', () => {
  assert.equal(shortCourseCode('CPE 421L'), 'CPE 421L');
});
test('truncates an unmatched long code with an ellipsis', () => {
  assert.equal(shortCourseCode('BSCPE-COMPUTER-NETWORKS', 12), 'BSCPE-COMPU…');
});
test('is case-insensitive on input but returns the matched segment uppercased', () => {
  assert.equal(shortCourseCode('3tsy2526_cs0061l_tn3'), 'CS0061L');
});
