import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGradeInfo } from '../../gradeScale';

const M = '−';
test('1.0 scale letters', () => {
  const cases: Array<[number, string, number, string]> = [
    [97, 'A+', 1.0, 'Excellent'], [95, 'A', 1.25, 'Very Good'], [92, 'A' + M, 1.5, 'Very Good'],
    [90, 'B+', 1.75, 'Good'], [87, 'B', 2.0, 'Good'], [85, 'B' + M, 2.25, 'Good'],
    [82, 'C+', 2.5, 'Fair'], [80, 'C', 2.75, 'Fair'], [75, 'C' + M, 3.0, 'Passed'], [60, 'F', 5.0, 'Failed'],
  ];
  for (const [pct, letter, point, desc] of cases) {
    const g = toGradeInfo(pct, '1pt');
    assert.equal(g.letter, letter, `pct ${pct}`); assert.equal(g.point, point); assert.equal(g.description, desc);
  }
});
test('4.0 scale unchanged', () => {
  assert.deepEqual(toGradeInfo(86.7, '4pt'), { point: 2.5, letter: 'C+', description: 'Good' });
});
