import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, suggestEmail } from '../emailTypo';

test('editDistance', () => {
  assert.equal(editDistance('gmail.com', 'gmail.com'), 0);
  assert.equal(editDistance('gmial.com', 'gmail.com'), 2);
  assert.equal(editDistance('gmail.co', 'gmail.com'), 1);
});

test('suggestEmail fixes near-miss domains, keeps the local part', () => {
  assert.equal(suggestEmail('juan@gmial.com'), 'juan@gmail.com');
  assert.equal(suggestEmail('Juan.DC@gmail.co'), 'Juan.DC@gmail.com');
  assert.equal(suggestEmail('juan@yaho.com'), 'juan@yahoo.com');
  assert.equal(suggestEmail('kd@fit.edu.pj'), 'kd@fit.edu.ph');
});

test('suggestEmail stays quiet when correct, unknown or malformed', () => {
  assert.equal(suggestEmail('juan@gmail.com'), null);
  assert.equal(suggestEmail('juan@mail.com'), null);
  assert.equal(suggestEmail('juan@feutech.edu.ph'), null);
  assert.equal(suggestEmail('juan'), null);
  assert.equal(suggestEmail('@gmail.com'), null);
});
