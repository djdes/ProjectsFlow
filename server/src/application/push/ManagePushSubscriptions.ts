import { isSupportedPushEndpoint, type PushSubscriptionKeys } from '../../domain/push/PushSubscription.js';
import { PushEndpointNotSupportedError } from '../../domain/push/errors.js';
import type { PushSubscriptionRepository } from './PushSubscriptionRepository.js';
import type { VapidKeyPair } from './VapidKeyProvider.js';

// Nobody needs more devices; the extra (longest silent) subscriptions are deleted.
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 20;

type Deps = {
  readonly repo: PushSubscriptionRepository;
  readonly vapid: { get(): Promise<VapidKeyPair> };
};

export type SubscribeInput = {
  readonly userId: string;
  readonly endpoint: string;
  readonly keys: PushSubscriptionKeys;
  readonly userAgent: string | null;
};

// Profile "notifications on this device": the server public key for pushManager.subscribe(),
// saving and deleting the current person's subscription.
export class ManagePushSubscriptions {
  constructor(private readonly deps: Deps) {}

  async publicKey(): Promise<string> {
    return (await this.deps.vapid.get()).publicKey;
  }

  async subscribe(input: SubscribeInput): Promise<void> {
    if (!isSupportedPushEndpoint(input.endpoint)) throw new PushEndpointNotSupportedError();
    await this.deps.repo.upsert({
      userId: input.userId,
      endpoint: input.endpoint,
      keys: input.keys,
      userAgent: input.userAgent,
    });
    await this.deps.repo.trimForUser(input.userId, MAX_PUSH_SUBSCRIPTIONS_PER_USER);
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.deps.repo.removeForUser(userId, endpoint);
  }
}
