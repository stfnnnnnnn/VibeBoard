import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, nameError, cleanEmail, emailError, passwordError, yearLevelFor } from '../validate';

test('cleanName trims and collapses spaces; non-strings become empty', () => {
  assert.equal(cleanName('  Juan   Dela  Cruz '), 'Juan Dela Cruz');
  assert.equal(cleanName(42), '');
});

test('nameError', () => {
  assert.equal(nameError('', 'first name'), 'Enter your first name.');
  assert.equal(nameError('María', 'first name'), null);
  assert.equal(nameError('李', 'first name'), null);
  assert.equal(nameError("O'Neil-Santos Jr.", 'last name'), null);
  assert.equal(nameError('x'.repeat(101), 'last name'), 'Last name is too long.');
  assert.equal(nameError('Juan😀', 'first name'), 'First name can only use letters, spaces, apostrophes, periods and hyphens.');
  assert.equal(nameError('<b>', 'first name'), 'First name can only use letters, spaces, apostrophes, periods and hyphens.');
});

test('email', () => {
  assert.equal(cleanEmail('  Juan@School.EDU.ph '), 'juan@school.edu.ph');
  assert.equal(emailError(''), 'Enter your email.');
  assert.equal(emailError('juan@school'), 'Enter a valid email, like you@school.edu.ph.');
  assert.equal(emailError('juan@school.edu.ph'), null);
  assert.equal(emailError(`${'a'.repeat(95)}@x.com`), 'That email is too long.');
});

test('passwordError', () => {
  assert.equal(passwordError(''), 'Enter a password.');
  assert.equal(passwordError('1234567'), 'Use at least 8 characters.');
  assert.equal(passwordError('12345678'), null);
  assert.equal(passwordError('é'.repeat(37)), 'Use 72 bytes or fewer (about 72 letters).');
});

test('yearLevelFor', () => {
  assert.equal(yearLevelFor('2nd'), '2nd Year');
  assert.equal(yearLevelFor('5th+'), '5th Year');
  assert.equal(yearLevelFor(''), null);
  assert.equal(yearLevelFor('6th'), null);
  assert.equal(yearLevelFor(undefined), null);
});
