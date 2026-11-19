import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribeToken.js';

const SECRET = 'test-secret-0123456789';
const USER = '1184438c-5935-4aba-ab80-c76f69c5b76c';

test('unsubscribe token round-trips and is URL-safe', () => {
  const token = createUnsubscribeToken(USER, SECRET);
  assert.match(token, /^[\w-]+\.[\w-]{22}$/);
  assert.equal(verifyUnsubscribeToken(token, SECRET), USER);
});

test('forged, tampered, truncated or foreign-secret tokens are rejected', () => {
  const token = createUnsubscribeToken(USER, SECRET);
  const other = '2284438c-5935-4aba-ab80-c76f69c5b76c';
  assert.equal(verifyUnsubscribeToken(`${other}.${token.split('.')[1]}`, SECRET), null);
  assert.equal(verifyUnsubscribeToken(token.slice(0, -1), SECRET), null);
  assert.equal(verifyUnsubscribeToken(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, SECRET), null);
  assert.equal(verifyUnsubscribeToken(token, 'another-secret-012345'), null);
  assert.equal(verifyUnsubscribeToken('garbage', SECRET), null);
  assert.equal(verifyUnsubscribeToken('x'.repeat(200), SECRET), null);
});
