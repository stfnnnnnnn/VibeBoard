import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetMail, googleAccountMail, verifyMail, absoluteUrl } from '../../email/templates';

test('absoluteUrl uses AUTH_URL without a trailing slash', () => {
  process.env.AUTH_URL = 'http://localhost:3000/';
  assert.equal(absoluteUrl('/reset-password?token=x'), 'http://localhost:3000/reset-password?token=x');
});

test('resetMail', () => {
  const m = resetMail({ firstName: 'Juan', url: 'http://localhost:3000/reset-password?token=abc', minutes: 30 });
  assert.equal(m.subject, 'Reset your VibeBoard password');
  assert.match(m.text, /http:\/\/localhost:3000\/reset-password\?token=abc/);
  assert.match(m.text, /30 minutes/);
  assert.match(m.html, /href="http:\/\/localhost:3000\/reset-password\?token=abc"/);
});

test('names are HTML-escaped', () => {
  const m = verifyMail({ firstName: '<img src=x onerror=alert(1)>', url: 'http://x/verify-email?token=1' });
  assert.equal(m.subject, 'Confirm your email for VibeBoard');
  assert.doesNotMatch(m.html, /<img src=x/);
  assert.match(m.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('googleAccountMail', () => {
  const m = googleAccountMail({ firstName: 'Ana', url: 'http://x/reset-password?token=2', minutes: 30 });
  assert.equal(m.subject, 'How to sign in to VibeBoard');
  assert.match(m.text, /Continue with Google/);
});

test('verifyMail tells people who did not sign up to ignore it', () => {
  const m = verifyMail({ firstName: 'Juan', url: 'http://x/verify-email?token=1' });
  assert.match(m.text, /Didn't create a VibeBoard account\? Ignore this email\./);
  assert.match(m.html, /Didn't create a VibeBoard account\? Ignore this email\./);
});
