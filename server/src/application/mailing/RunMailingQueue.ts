import type { EmailSender } from '../notifications/EmailSender.js';
import type { MailingRepository } from './MailingRepository.js';
import type { MailingDelivery } from '../../domain/mailing/Mailing.js';
import {
  MAILING_STALE_CLAIM_MS,
  mailingBudget,
  mailingSendFailure,
} from '../../domain/mailing/deliveryPolicy.js';
import { renderMailingEmail } from './mailingEmail.js';

type Deps = {
  readonly repo: MailingRepository;
  readonly email: EmailSender;
  readonly perMinute: number;
  readonly unsubscribeUrl: (userId: string) => string;
  // Public app origin for the hero images of promo layouts.
  readonly assetBaseUrl?: string;
  readonly now: () => Date;
};

export const STALE_CLAIM_ERROR = 'Отправка прервана перезапуском сервера — доставка не подтверждена';

/**
 * The mailing queue worker: mailing_recipients is the durable queue, one row per letter.
 * Each pass fails stale claims, claims what the per-minute budget allows (conditional
 * UPDATE, so parallel passes or processes never claim the same row), re-checks the
 * unsubscribe list right before handing the letter over and records the outcome.
 */
export class RunMailingQueue {
  private running = false;

  constructor(private readonly deps: Deps) {}

  wake = (): void => {
    void this.run().catch((error: unknown) => console.error('[mailing-queue]', error instanceof Error ? error.message : 'failed'));
  };

  async run(): Promise<{ sent: number; failed: number; skipped: number; retried: number }> {
    const stats = { sent: 0, failed: 0, skipped: 0, retried: 0 };
    if (this.running) return stats;
    this.running = true;
    try {
      const { repo } = this.deps;
      const start = this.deps.now();
      await repo.failStaleClaims(new Date(start.getTime() - MAILING_STALE_CLAIM_MS), STALE_CLAIM_ERROR);
      const budget = mailingBudget(this.deps.perMinute, await repo.countSentSince(new Date(start.getTime() - 60_000)));
      const batch = budget > 0 ? await repo.claimDue(start, budget) : [];
      for (const delivery of batch) stats[await this.deliver(delivery)]++;
      await repo.completeDrained(this.deps.now());
      return stats;
    } finally {
      this.running = false;
    }
  }

  private async deliver(d: MailingDelivery): Promise<'sent' | 'failed' | 'skipped' | 'retried'> {
    const { repo } = this.deps;
    // The user may have unsubscribed after launch; that wins over the queued letter.
    if (await repo.isUnsubscribed(d.userId)) {
      await repo.markSkipped(d, 'Получатель отписался');
      return 'skipped';
    }
    const message = renderMailingEmail({
      to: d.email,
      content: d.content,
      vars: { name: d.displayName, workspace: d.workspaceName ?? '' },
      unsubscribeUrl: this.deps.unsubscribeUrl(d.userId),
      assetBaseUrl: this.deps.assetBaseUrl,
    });
    try {
      await this.deps.email.send(message);
    } catch (error) {
      const outcome = mailingSendFailure(error, d.attempts, this.deps.now());
      if (outcome.kind === 'retry') {
        await repo.markRetry(d, outcome.at, outcome.error);
        return 'retried';
      }
      await repo.markFailed(d, outcome.error);
      return 'failed';
    }
    await repo.markSent(d, this.deps.now());
    return 'sent';
  }
}
