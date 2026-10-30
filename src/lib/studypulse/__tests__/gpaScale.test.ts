import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertToGPA } from '../gpaScale';

test('band edges match the stats route scale', () => {
  const cases: Array<[number, number]> = [
    [69.99, 0.5], [70, 1.0], [74.9, 1.0], [75, 1.5], [80, 2.0], [84.9, 2.0],
    [85, 2.5], [88.9, 2.5], [89, 3.0], [92, 3.0], [92.5, 3.5], [96, 3.5], [96.1, 4.0], [100, 4.0],
  ];
  for (const [g, gpa] of cases) assert.equal(convertToGPA(g), gpa, String(g));
});
