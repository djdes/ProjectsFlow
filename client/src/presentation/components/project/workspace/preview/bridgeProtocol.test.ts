import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostMessage, parseFrameMessage, SITE_EDITOR_PROTOCOL, SITE_EDITOR_VERSION } from './bridgeProtocol';

test('accepts only the exact protocol version and session nonce', () => {
  const valid = { protocol: SITE_EDITOR_PROTOCOL, version: SITE_EDITOR_VERSION, sessionNonce: 'nonce', type: 'ready', payload: { path: '/' } };
  assert.deepEqual(parseFrameMessage(valid, 'nonce'), valid);
  assert.equal(parseFrameMessage({ ...valid, sessionNonce: 'other' }, 'nonce'), null);
  assert.equal(parseFrameMessage({ ...valid, version: 2 }, 'nonce'), null);
  assert.equal(parseFrameMessage({ ...valid, type: 'unknown' }, 'nonce'), null);
});

test('creates a versioned host envelope', () => {
  assert.deepEqual(createHostMessage('n', 'navigate', { path: '/catalog' }), { protocol: SITE_EDITOR_PROTOCOL, version: SITE_EDITOR_VERSION, sessionNonce: 'n', type: 'navigate', payload: { path: '/catalog' } });
});
