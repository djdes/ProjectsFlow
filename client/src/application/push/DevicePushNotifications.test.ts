import assert from 'node:assert/strict';
import test from 'node:test';
import type { DevicePushPermission, DevicePushSubscription } from '@/domain/push/DevicePush';
import type { DevicePush, DevicePushEnvironment } from './DevicePush';
import type { PushSubscriptionRepository } from './PushSubscriptionRepository';
import { DevicePushError, DevicePushNotifications } from './DevicePushNotifications';

class FakeDevice implements DevicePush {
  env: DevicePushEnvironment = { supported: true, ios: false, standalone: false };
  perm: DevicePushPermission = 'default';
  answer: DevicePushPermission = 'granted';
  subscription: DevicePushSubscription | null = null;
  log: string[] = [];
  environment(): DevicePushEnvironment { return this.env; }
  permission(): DevicePushPermission { return this.perm; }
  async requestPermission(): Promise<DevicePushPermission> {
    this.log.push('request-permission');
    this.perm = this.answer;
    return this.answer;
  }
  async current(): Promise<DevicePushSubscription | null> { return this.subscription; }
  async subscribe(key: string): Promise<DevicePushSubscription> {
    this.log.push(`subscribe:${key}`);
    this.subscription = { endpoint: `https://web.push.apple.com/${key}`, keys: { p256dh: 'p', auth: 'a' }, applicationServerKey: key };
    return this.subscription;
  }
  async unsubscribe(): Promise<void> {
    this.log.push('unsubscribe');
    this.subscription = null;
  }
}

class FakeRepo implements PushSubscriptionRepository {
  key = 'server-key';
  saved: string[] = [];
  removed: string[] = [];
  failSave: Error | null = null;
  keyRequests = 0;
  async getPublicKey(): Promise<string> { this.keyRequests += 1; return this.key; }
  async save(subscription: DevicePushSubscription): Promise<void> {
    if (this.failSave) throw this.failSave;
    this.saved.push(subscription.endpoint);
  }
  async remove(endpoint: string): Promise<void> { this.removed.push(endpoint); }
  tested: string[] = [];
  async sendTest(endpoint: string): Promise<void> { this.tested.push(endpoint); }
}

function setup() {
  const device = new FakeDevice();
  const repo = new FakeRepo();
  return { device, repo, push: new DevicePushNotifications(device, repo) };
}

test('iPhone in Safari is told to add the app to the Home Screen', async () => {
  const { device, push } = setup();
  device.env = { supported: false, ios: true, standalone: false };
  assert.deepEqual(await push.getState(), { kind: 'needs_home_screen' });
  assert.deepEqual(await push.enable(), { kind: 'needs_home_screen' });
  assert.deepEqual(device.log, []);
});

test('a browser without push and a denied permission are reported as such', async () => {
  const { device, push } = setup();
  device.env = { supported: false, ios: true, standalone: true };
  assert.deepEqual(await push.getState(), { kind: 'unsupported', ios: true });
  device.env = { supported: true, ios: false, standalone: false };
  device.perm = 'denied';
  assert.deepEqual(await push.getState(), { kind: 'denied', ios: false });
});

test('enabling asks for permission first, subscribes with the server key and saves the subscription', async () => {
  const { device, repo, push } = setup();
  assert.deepEqual(await push.getState(), { kind: 'ready', enabled: false });

  assert.deepEqual(await push.enable(), { kind: 'ready', enabled: true });

  assert.deepEqual(device.log, ['request-permission', 'subscribe:server-key']);
  assert.deepEqual(repo.saved, ['https://web.push.apple.com/server-key']);
  assert.equal(repo.keyRequests, 1, 'the key fetched for the card is reused');
  assert.deepEqual(await push.getState(), { kind: 'ready', enabled: true });
});

test('a refused or dismissed permission prompt does not subscribe', async () => {
  const { device, repo, push } = setup();
  device.answer = 'denied';
  assert.deepEqual(await push.enable(), { kind: 'denied', ios: false });
  device.perm = 'default';
  device.answer = 'default';
  await assert.rejects(push.enable(), (error: unknown) => error instanceof DevicePushError && error.code === 'permission_dismissed');
  assert.deepEqual(repo.saved, []);
  assert.equal(device.subscription, null);
});

test('when the server refuses the subscription the browser is unsubscribed again', async () => {
  const { device, repo, push } = setup();
  repo.failSave = new DevicePushError('impersonation');
  await assert.rejects(push.enable(), (error: unknown) => error instanceof DevicePushError && error.code === 'impersonation');
  assert.equal(device.subscription, null);
});

test('a test push is requested for this device only when it is subscribed', async () => {
  const { repo, push } = setup();
  await assert.rejects(push.sendTest(), DevicePushError);
  await push.enable();
  await push.sendTest();
  assert.deepEqual(repo.tested, ['https://web.push.apple.com/server-key']);
});

test('disabling removes the subscription on the server and in the browser', async () => {
  const { device, repo, push } = setup();
  await push.enable();
  assert.deepEqual(await push.disable(), { kind: 'ready', enabled: false });
  assert.deepEqual(repo.removed, ['https://web.push.apple.com/server-key']);
  assert.equal(device.subscription, null);
});

test('sync re-registers the device for the signed-in account and follows a new server key', async () => {
  const { device, repo, push } = setup();
  await push.sync();
  assert.deepEqual(repo.saved, [], 'nothing to sync without permission and subscription');

  await push.enable();
  repo.saved = [];
  await new DevicePushNotifications(device, repo).sync();
  assert.deepEqual(repo.saved, ['https://web.push.apple.com/server-key']);

  repo.key = 'rotated-key';
  repo.saved = [];
  await new DevicePushNotifications(device, repo).sync();
  assert.deepEqual(repo.removed, ['https://web.push.apple.com/server-key']);
  assert.deepEqual(repo.saved, ['https://web.push.apple.com/rotated-key']);
});
