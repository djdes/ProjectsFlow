import type { DevicePushState, DevicePushSubscription } from '@/domain/push/DevicePush';
import type { DevicePush } from './DevicePush';
import type { PushSubscriptionRepository } from './PushSubscriptionRepository';

export type DevicePushErrorCode =
  // The permission prompt was closed without an answer.
  | 'permission_dismissed'
  // The service worker did not start (for example in development mode).
  | 'service_worker_unavailable'
  // The browser did not issue a subscription.
  | 'subscribe_failed'
  // The server does not know this browser's push service.
  | 'push_service_not_supported'
  // An admin is signed in as another user.
  | 'impersonation'
  | 'unknown';

// Use-case error; adapters translate transport and browser errors into it.
export class DevicePushError extends Error {
  constructor(
    public readonly code: DevicePushErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DevicePushError';
  }
}

// "Notifications on this device": the profile state, switching on and off, and a silent sync on
// app start (the subscription follows the signed-in account and the server key).
export class DevicePushNotifications {
  private publicKey: Promise<string> | null = null;

  constructor(
    private readonly device: DevicePush,
    private readonly repo: PushSubscriptionRepository,
  ) {}

  async getState(): Promise<DevicePushState> {
    const blocked = this.blockedState();
    if (blocked) return blocked;
    // Fetch the server key in advance: a tap on the switch then only has to ask for permission.
    void this.serverKey().catch(() => undefined);
    if (this.device.permission() !== 'granted') return { kind: 'ready', enabled: false };
    return { kind: 'ready', enabled: (await this.device.current()) !== null };
  }

  // Call straight from a tap handler: there is no await before the permission request here,
  // otherwise Safari on iPhone does not show the prompt.
  async enable(): Promise<DevicePushState> {
    const blocked = this.blockedState();
    if (blocked) return blocked;
    const key = this.serverKey();
    key.catch(() => undefined);
    const permission = await this.device.requestPermission();
    if (permission === 'denied') return { kind: 'denied', ios: this.device.environment().ios };
    if (permission !== 'granted') throw new DevicePushError('permission_dismissed');
    const publicKey = await key;
    let subscription = await this.device.current();
    if (subscription && !this.matches(subscription, publicKey)) {
      await this.drop(subscription);
      subscription = null;
    }
    const fresh = subscription ?? await this.device.subscribe(publicKey);
    try {
      await this.repo.save(fresh);
    } catch (error) {
      // The server refused the subscription: do not leave the browser subscribed for nothing.
      if (!subscription) await this.device.unsubscribe().catch(() => undefined);
      throw error;
    }
    return { kind: 'ready', enabled: true };
  }

  // The profile switch and signing out.
  async disable(): Promise<DevicePushState> {
    const subscription = await this.device.current().catch(() => null);
    if (subscription) await this.drop(subscription);
    return this.blockedState() ?? { kind: 'ready', enabled: false };
  }

  // A test notification to this device, sent by the server through the same push service.
  async sendTest(): Promise<void> {
    const subscription = await this.device.current();
    if (!subscription) throw new DevicePushError('subscribe_failed', 'Уведомления на этом устройстве выключены');
    await this.repo.sendTest(subscription.endpoint);
  }

  // On app start the server receives this device's subscription again: after an account change
  // on the device it moves to the current account, after a server key change the browser
  // resubscribes. Never asks the person anything.
  async sync(): Promise<void> {
    if (this.blockedState() || this.device.permission() !== 'granted') return;
    const subscription = await this.device.current();
    if (!subscription) return;
    const publicKey = await this.serverKey();
    if (this.matches(subscription, publicKey)) {
      await this.repo.save(subscription);
      return;
    }
    await this.drop(subscription);
    await this.repo.save(await this.device.subscribe(publicKey));
  }

  private blockedState(): DevicePushState | null {
    const env = this.device.environment();
    if (env.ios && !env.standalone) return { kind: 'needs_home_screen' };
    if (!env.supported) return { kind: 'unsupported', ios: env.ios };
    if (this.device.permission() === 'denied') return { kind: 'denied', ios: env.ios };
    return null;
  }

  private matches(subscription: DevicePushSubscription, publicKey: string): boolean {
    return subscription.applicationServerKey === null || subscription.applicationServerKey === publicKey;
  }

  // Server first (while the session exists), then the browser. If the server is unreachable,
  // unsubscribing in the browser still kills the endpoint: the push service answers the server
  // with 410 and the row is deleted.
  private async drop(subscription: DevicePushSubscription): Promise<void> {
    await this.repo.remove(subscription.endpoint).catch(() => undefined);
    await this.device.unsubscribe();
  }

  private serverKey(): Promise<string> {
    if (!this.publicKey) {
      this.publicKey = this.repo.getPublicKey().catch((error: unknown) => {
        this.publicKey = null;
        throw error;
      });
    }
    return this.publicKey;
  }
}
