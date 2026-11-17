import webpush from 'web-push';
import type { PushSubscription } from '../../domain/push/PushSubscription.js';
import type { PushSender, PushSendResult, VapidCredentials } from '../../application/push/PushSender.js';
import type { VapidKeyGenerator, VapidKeyPair } from '../../application/push/VapidKeyProvider.js';

type Options = {
  // Proxy for outgoing requests to push services (WEB_PUSH_HTTP_PROXY) when the direct route is closed.
  readonly proxy?: string | undefined;
  readonly timeoutMs?: number;
  // How long the push service keeps a message for a device that is offline.
  readonly ttlSeconds?: number;
};

function statusCodeOf(error: unknown): number | null {
  if (error instanceof webpush.WebPushError) return error.statusCode;
  const code = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === 'number' ? code : null;
}

// Push delivery with the web-push package: payload encryption (aes128gcm) and VAPID signing.
export class WebPushSender implements PushSender {
  constructor(private readonly options: Options = {}) {}

  async send(
    subscription: Pick<PushSubscription, 'endpoint' | 'keys'>,
    payload: string,
    vapid: VapidCredentials,
  ): Promise<PushSendResult> {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } },
        payload,
        {
          vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
          TTL: this.options.ttlSeconds ?? 24 * 60 * 60,
          urgency: 'high',
          timeout: this.options.timeoutMs ?? 15_000,
          ...(this.options.proxy ? { proxy: this.options.proxy } : {}),
        },
      );
      return { status: 'sent' };
    } catch (error) {
      const statusCode = statusCodeOf(error);
      if (statusCode === 404 || statusCode === 410) return { status: 'gone', statusCode };
      const body = (error as { body?: unknown } | null)?.body;
      const message = [error instanceof Error ? error.message : String(error), typeof body === 'string' ? body.slice(0, 200) : '']
        .filter(Boolean)
        .join(' — ');
      return { status: 'failed', statusCode, message };
    }
  }
}

export class WebPushVapidKeyGenerator implements VapidKeyGenerator {
  generate(): VapidKeyPair {
    const { publicKey, privateKey } = webpush.generateVAPIDKeys();
    return { publicKey, privateKey };
  }
}
