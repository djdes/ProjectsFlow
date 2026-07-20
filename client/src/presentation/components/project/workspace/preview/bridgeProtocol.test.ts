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

test('carries the select command inside the v1 envelope', () => {
  // Команда выделения зоны добавлена аддитивно. Версия обязана остаться прежней:
  // скрипт моста кешируется на 300 секунд, и бамп разом отрезал бы все живые бриджи,
  // тогда как незнакомый тип старый мост просто игнорирует.
  assert.equal(SITE_EDITOR_VERSION, 1);
  assert.deepEqual(createHostMessage('n', 'select', { selector: 'main > h1' }), {
    protocol: SITE_EDITOR_PROTOCOL, version: 1, sessionNonce: 'n', type: 'select', payload: { selector: 'main > h1' },
  });
});
