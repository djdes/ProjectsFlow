import type { Notification } from '../../domain/notifications/Notification.js';
import type { PushMessage, PushSubscription } from '../../domain/push/PushSubscription.js';
import type { NotificationPublisher } from '../notifications/NotificationPublisher.js';
import type { PushSender, PushSendResult } from './PushSender.js';
import type { PushSubscriptionRepository } from './PushSubscriptionRepository.js';
import type { VapidKeyPair } from './VapidKeyProvider.js';
import { pushMessageFor } from './pushMessage.js';

type Deps = {
  readonly subscriptions: PushSubscriptionRepository;
  readonly sender: PushSender;
  readonly vapid: { get(): Promise<VapidKeyPair> };
  readonly subject: string;
  // The same check as for toasts (NotificationAlerts.canReceive): a former workspace member
  // gets nothing about its tasks.
  readonly canReceive?: (userId: string, notification: Notification) => Promise<boolean>;
  readonly now?: () => Date;
  readonly log?: (message: string, error?: unknown) => void;
};

export type PushDispatchSummary = {
  readonly sent: number;
  readonly gone: number;
  readonly failed: number;
};

const NOTHING: PushDispatchSummary = { sent: 0, gone: 0, failed: 0 };

const TEST_MESSAGE: PushMessage = {
  title: 'Уведомления работают',
  body: 'Так будут приходить упоминания, назначения и изменения ваших задач.',
  url: '/profile',
  workspaceId: null,
};

// Pushes every created in-app (bell) notification to the recipient's devices. It is plugged
// into PublishingNotificationRepository next to the SSE hub, so it covers every notification
// source. publish() neither waits for delivery nor throws: the original request (a comment, a
// status change…) is never slowed down or failed by push services.
export class PushNotificationDispatcher implements NotificationPublisher {
  constructor(private readonly deps: Deps) {}

  publish(notification: Notification): void {
    void this.dispatch(notification).catch((error: unknown) => {
      this.log('[push] dispatch failed', error);
    });
  }

  async dispatch(notification: Notification): Promise<PushDispatchSummary> {
    const subscriptions = await this.deps.subscriptions.listByUser(notification.userId);
    if (subscriptions.length === 0) return NOTHING;
    if (this.deps.canReceive && !(await this.deps.canReceive(notification.userId, notification))) return NOTHING;
    return this.deliver(subscriptions, pushMessageFor(notification));
  }

  // The profile "send a test" button: a test push to one device of the person.
  async sendTest(userId: string, endpoint: string): Promise<PushDispatchSummary> {
    const subscriptions = (await this.deps.subscriptions.listByUser(userId))
      .filter((subscription) => subscription.endpoint === endpoint);
    if (subscriptions.length === 0) return NOTHING;
    return this.deliver(subscriptions, TEST_MESSAGE);
  }

  private async deliver(subscriptions: readonly PushSubscription[], message: PushMessage): Promise<PushDispatchSummary> {
    const keys = await this.deps.vapid.get();
    const vapid = { ...keys, subject: this.deps.subject };
    const payload = JSON.stringify(message);
    const results = await Promise.all(subscriptions.map(async (subscription): Promise<PushSendResult['status']> => {
      let result: PushSendResult;
      try {
        result = await this.deps.sender.send(subscription, payload, vapid);
      } catch (error) {
        result = { status: 'failed', statusCode: null, message: error instanceof Error ? error.message : String(error) };
      }
      try {
        if (result.status === 'gone') await this.deps.subscriptions.remove(subscription.endpoint);
        else if (result.status === 'sent') await this.deps.subscriptions.markSuccess(subscription.endpoint, this.now());
        else this.log(`[push] delivery failed (${result.statusCode ?? 'network'}): ${result.message}`);
      } catch (error) {
        this.log('[push] subscription bookkeeping failed', error);
      }
      return result.status;
    }));
    return {
      sent: results.filter((status) => status === 'sent').length,
      gone: results.filter((status) => status === 'gone').length,
      failed: results.filter((status) => status === 'failed').length,
    };
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private log(message: string, error?: unknown): void {
    if (this.deps.log) this.deps.log(message, error);
    else console.warn(message, error ?? '');
  }
}
