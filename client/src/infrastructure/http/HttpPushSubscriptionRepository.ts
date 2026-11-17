import type { PushSubscriptionRepository } from '@/application/push/PushSubscriptionRepository';
import { DevicePushError } from '@/application/push/DevicePushNotifications';
import type { DevicePushSubscription } from '@/domain/push/DevicePush';
import { HttpError, httpClient } from './httpClient';

// /api/push: device subscriptions of the current person (cookie session).
export class HttpPushSubscriptionRepository implements PushSubscriptionRepository {
  async getPublicKey(): Promise<string> {
    const { publicKey } = await httpClient.get<{ publicKey: string }>('/push/public-key');
    return publicKey;
  }

  async save(subscription: DevicePushSubscription): Promise<void> {
    try {
      await httpClient.post<void>('/push/subscriptions', {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      });
    } catch (e) {
      throw mapError(e);
    }
  }

  async remove(endpoint: string): Promise<void> {
    await httpClient.delete<void>('/push/subscriptions', { endpoint });
  }

  async sendTest(endpoint: string): Promise<void> {
    await httpClient.post<void>('/push/test', { endpoint });
  }
}

function mapError(e: unknown): unknown {
  if (e instanceof HttpError) {
    if (e.status === 403 && e.body.error === 'impersonation_forbidden') return new DevicePushError('impersonation', e.body.message);
    if (e.status === 400 && e.body.error === 'push_service_not_supported') {
      return new DevicePushError('push_service_not_supported', e.body.message);
    }
  }
  return e;
}
