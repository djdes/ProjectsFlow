import type { DevicePush, DevicePushEnvironment } from '@/application/push/DevicePush';
import { DevicePushError } from '@/application/push/DevicePushNotifications';
import type { DevicePushPermission, DevicePushSubscription } from '@/domain/push/DevicePush';
import { isIOSDevice, isStandaloneDisplay } from '@/lib/platform';

// How long to wait for the service worker before subscribing (it registers after page load).
const READY_TIMEOUT_MS = 8000;

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(buffer: ArrayBuffer | null | undefined): string | null {
  if (!buffer) return null;
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toSubscription(subscription: PushSubscription): DevicePushSubscription {
  const keys = subscription.toJSON().keys;
  if (!keys?.['p256dh'] || !keys['auth']) throw new DevicePushError('subscribe_failed', 'Браузер не выдал ключи подписки');
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: keys['p256dh'], auth: keys['auth'] },
    applicationServerKey: bytesToBase64Url(subscription.options?.applicationServerKey),
  };
}

// The browser Push API: notification permission and a subscription via the service worker (public/sw.js).
export class BrowserDevicePush implements DevicePush {
  environment(): DevicePushEnvironment {
    const supported = typeof window !== 'undefined'
      && 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window;
    return { supported, ios: isIOSDevice(), standalone: isStandaloneDisplay() };
  }

  permission(): DevicePushPermission {
    return typeof Notification === 'undefined' ? 'default' : Notification.permission;
  }

  requestPermission(): Promise<DevicePushPermission> {
    // Old Safari only supports the callback form; newer browsers support both.
    return new Promise((resolve) => {
      const done = (value: NotificationPermission): void => resolve(value);
      const result = Notification.requestPermission(done) as Promise<NotificationPermission> | undefined;
      result?.then(done, () => done(Notification.permission));
    });
  }

  async current(): Promise<DevicePushSubscription | null> {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return subscription ? toSubscription(subscription) : null;
  }

  async subscribe(applicationServerKey: string): Promise<DevicePushSubscription> {
    const registration = await this.readyRegistration();
    let subscription: PushSubscription;
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(applicationServerKey),
      });
    } catch (error) {
      throw new DevicePushError('subscribe_failed', error instanceof Error ? error.message : String(error));
    }
    return toSubscription(subscription);
  }

  async unsubscribe(): Promise<void> {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  }

  private readyRegistration(): Promise<ServiceWorkerRegistration> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new DevicePushError('service_worker_unavailable')), READY_TIMEOUT_MS);
      navigator.serviceWorker.ready.then(
        (registration) => { clearTimeout(timer); resolve(registration); },
        (error: unknown) => { clearTimeout(timer); reject(error); },
      );
    });
  }
}
