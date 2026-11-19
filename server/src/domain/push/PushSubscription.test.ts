import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUSH_ENDPOINT_MAX_LENGTH, isSupportedPushEndpoint } from './PushSubscription.js';

test('accepts the push services of real browsers', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://fcm.googleapis.com/wp/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ]) {
    assert.equal(isSupportedPushEndpoint(endpoint), true, endpoint);
  }
});

test('rejects anything the server should not post to', () => {
  for (const endpoint of [
    '',
    'not a url',
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pass@fcm.googleapis.com/fcm/send/abc',
    'https://localhost/push',
    'https://10.0.0.1/push',
    'https://googleapis.com.evil.example/push',
    'https://evilpush.apple.com/x',
    `https://fcm.googleapis.com/${'a'.repeat(PUSH_ENDPOINT_MAX_LENGTH)}`,
  ]) {
    assert.equal(isSupportedPushEndpoint(endpoint), false, endpoint);
  }
});
