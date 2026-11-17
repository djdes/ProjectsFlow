import type { DevicePushSubscription } from '@/domain/push/DevicePush';

// Port: device subscriptions on the server (/api/push). Implementation: HttpPushSubscriptionRepository.
export interface PushSubscriptionRepository {
  getPublicKey(): Promise<string>;
  save(subscription: DevicePushSubscription): Promise<void>;
  remove(endpoint: string): Promise<void>;
  // A test push to this device.
  sendTest(endpoint: string): Promise<void>;
}
