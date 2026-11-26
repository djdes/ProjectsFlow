import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitsOfflineStore, isNetworkFailure, isOfflineCacheable, offlineKey, offlinePathOf } from './offlineReads';

test('reads are cacheable, auth flows and streams are not', () => {
  assert.equal(isOfflineCacheable('/auth/me'), true);
  assert.equal(isOfflineCacheable('/auth/login'), false);
  assert.equal(isOfflineCacheable('/projects/p1/tasks'), true);
  assert.equal(isOfflineCacheable('/projects/p1/live/sessions/s1/stream'), false);
  assert.equal(isOfflineCacheable('/notifications/stream?x=1'), false);
});

test('keys separate accounts and workspaces', () => {
  assert.notEqual(offlineKey('u1', 'w1', '/tasks'), offlineKey('u2', 'w1', '/tasks'));
  assert.notEqual(offlineKey('u1', 'w1', '/tasks'), offlineKey('u1', 'w2', '/tasks'));
  assert.equal(offlineKey('u1', null, '/tasks'), '/__pf/offline/u1/account/tasks');
  assert.equal(offlinePathOf(offlineKey('u1', 'w1', '/assignees/overview'), 'u1'), '/assignees/overview');
  assert.equal(offlinePathOf(offlineKey('u1', 'w1', '/projects/p1/tasks'), 'u1'), '/projects/p1/tasks');
  assert.equal(offlinePathOf(offlineKey('u2', 'w1', '/assignees/overview'), 'u1'), null);
});

test('network failures are told apart from HTTP errors', () => {
  assert.equal(isNetworkFailure(new TypeError('Failed to fetch')), true);
  assert.equal(isNetworkFailure(new Error('Сервер не ответил вовремя. Проверьте соединение и повторите попытку.')), true);
  assert.equal(isNetworkFailure(new Error('boom')), false);
});

test('empty and huge bodies are not stored', () => {
  assert.equal(fitsOfflineStore(''), false);
  assert.equal(fitsOfflineStore('{"a":1}'), true);
  assert.equal(fitsOfflineStore('x'.repeat(400_001)), false);
});
