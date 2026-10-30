import { test } from 'node:test';
import assert from 'node:assert/strict';
import { section } from '../section';

test('wraps a resolved value', async () => {
  assert.deepEqual(await section('x', async () => 5), { ok: true, data: 5 });
});
test('keeps a null "not set up" value as ok', async () => {
  assert.deepEqual(await section('x', async () => null), { ok: true, data: null });
});
test('turns a rejection into ok:false instead of throwing', async () => {
  const orig = console.error; console.error = () => {};
  try {
    assert.deepEqual(await section('x', async () => { throw new Error('db down'); }), { ok: false });
  } finally { console.error = orig; }
});
