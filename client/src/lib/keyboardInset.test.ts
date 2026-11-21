import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyboardInset } from './keyboardInset';

test('browser bar jitter is not a keyboard', () => {
  assert.equal(keyboardInset(844, 780, 0), 0);
});

test('a real keyboard reports its height', () => {
  assert.equal(keyboardInset(844, 508, 0), 336);
});

test('a scrolled visual viewport subtracts its offset', () => {
  assert.equal(keyboardInset(844, 508, 336), 0);
});
