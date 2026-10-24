import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePassword } from '../passwordStrength';

test('scorePassword', () => {
  assert.deepEqual(scorePassword(''), { score: 0, label: '', hint: 'At least 8 characters.' });
  assert.deepEqual(scorePassword('abc'), { score: 0, label: 'Too short', hint: '5 more characters.' });
  assert.deepEqual(scorePassword('abcdefg'), { score: 0, label: 'Too short', hint: '1 more character.' });
  assert.equal(scorePassword('password').label, 'Too common');
  assert.equal(scorePassword('Password1').score, 1);           // common list is case-insensitive
  assert.equal(scorePassword('aaaaaaaaaa').label, 'Too common'); // one repeated character
  assert.deepEqual(scorePassword('abcdefgh'), { score: 1, label: 'Weak', hint: 'Make it longer or mix in numbers and symbols.' });
  assert.deepEqual(scorePassword('abcdefghijkl'), { score: 2, label: 'Fair', hint: 'Longer is stronger. Try 12+ characters with a number.' });
  assert.deepEqual(scorePassword('Juandelacruz7'), { score: 3, label: 'Strong enough', hint: 'Add a symbol to make it great.' });
  assert.deepEqual(scorePassword('Juan dela Cruz 2026!'), { score: 4, label: 'Great password', hint: '' });
  // Over the bcrypt limit (72 UTF-8 bytes): a warning, never "Great password".
  assert.deepEqual(scorePassword('Aa1!'.repeat(19)), { score: 1, label: 'Too long', hint: 'Use 72 bytes or fewer.' }); // 76 bytes
  assert.equal(scorePassword('Aa1!'.repeat(18)).label, 'Great password');                                                  // 72 bytes
  assert.equal(scorePassword('ñ'.repeat(37)).label, 'Too long');                                                          // 37 chars, 74 bytes
});
