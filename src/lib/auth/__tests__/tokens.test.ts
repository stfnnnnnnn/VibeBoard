import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newToken, hashToken, RESET_TTL_MIN, VERIFY_TTL_MIN, RESEND_COOLDOWN_SEC } from '../tokens';

test('newToken is 43-char base64url and unique', () => {
  const a = newToken(), b = newToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test('hashToken is stable sha256 hex', () => {
  assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.match(hashToken(newToken()), /^[0-9a-f]{64}$/);
});

test('constants', () => {
  assert.equal(RESET_TTL_MIN, 30);
  assert.equal(VERIFY_TTL_MIN, 1440);
  assert.equal(RESEND_COOLDOWN_SEC, 60);
});
