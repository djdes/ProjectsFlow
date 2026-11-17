import type { PushSubscription } from '../../domain/push/PushSubscription.js';
import type { PushSender, PushSendResult, VapidCredentials } from './PushSender.js';
import type { PushSubscriptionRepository } from './PushSubscriptionRepository.js';

// Shared fakes of the push module tests (not a *.test.ts file, so node --test does not run it).

export class InMemoryPushSubscriptions implements PushSubscriptionRepository {
  rows: Array<PushSubscription & { lastSuccessAt: Date | null; seq: number }> = [];
  private seq = 0;

  async upsert(subscription: PushSubscription): Promise<void> {
    const existing = this.rows.find((row) => row.endpoint === subscription.endpoint);
    if (existing) {
      Object.assign(existing, subscription);
      return;
    }
    this.rows.push({ ...subscription, lastSuccessAt: null, seq: ++this.seq });
  }

  async removeForUser(userId: string, endpoint: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !(row.userId === userId && row.endpoint === endpoint));
    return this.rows.length !== before;
  }

  async remove(endpoint: string): Promise<void> {
    this.rows = this.rows.filter((row) => row.endpoint !== endpoint);
  }

  async listByUser(userId: string): Promise<PushSubscription[]> {
    return this.rows
      .filter((row) => row.userId === userId)
      .map(({ userId: owner, endpoint, keys, userAgent }) => ({ userId: owner, endpoint, keys, userAgent }));
  }

  async markSuccess(endpoint: string, at: Date): Promise<void> {
    const row = this.rows.find((r) => r.endpoint === endpoint);
    if (row) row.lastSuccessAt = at;
  }

  async trimForUser(userId: string, keep: number): Promise<void> {
    const mine = this.rows
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.seq - a.seq);
    const drop = new Set(mine.slice(keep).map((row) => row.endpoint));
    this.rows = this.rows.filter((row) => !drop.has(row.endpoint));
  }

  async removeAll(): Promise<number> {
    const count = this.rows.length;
    this.rows = [];
    return count;
  }
}

export type SentPush = {
  readonly endpoint: string;
  readonly payload: unknown;
  readonly vapid: VapidCredentials;
};

export class FakePushSender implements PushSender {
  sent: SentPush[] = [];
  constructor(private readonly respond: (endpoint: string) => PushSendResult | Promise<PushSendResult> = () => ({ status: 'sent' })) {}

  async send(subscription: Pick<PushSubscription, 'endpoint' | 'keys'>, payload: string, vapid: VapidCredentials): Promise<PushSendResult> {
    this.sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) as unknown, vapid });
    return this.respond(subscription.endpoint);
  }
}

export function subscription(userId: string, endpoint: string): PushSubscription {
  return { userId, endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' }, userAgent: 'test' };
}
