import type { PushSubscription } from '../../domain/push/PushSubscription.js';

// Port for device subscriptions (db/184, push_subscriptions).
export interface PushSubscriptionRepository {
  // By endpoint: inserts a row or replaces keys, owner and user agent of the existing one.
  upsert(subscription: PushSubscription): Promise<void>;
  removeForUser(userId: string, endpoint: string): Promise<boolean>;
  // The push service answered "no such subscription" (404/410): the row is useless, whoever owns it.
  remove(endpoint: string): Promise<void>;
  listByUser(userId: string): Promise<PushSubscription[]>;
  markSuccess(endpoint: string, at: Date): Promise<void>;
  // Keeps the `keep` most recently active subscriptions of a person and deletes the rest.
  trimForUser(userId: string, keep: number): Promise<void>;
  // The VAPID keys changed: old subscriptions are bound to the previous key and cannot work.
  removeAll(): Promise<number>;
}
