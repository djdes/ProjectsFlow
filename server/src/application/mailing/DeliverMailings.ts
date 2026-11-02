import type { MailingRepository } from './MailingRepository.js';
import type { MailingTransport } from './MailingTransport.js';
import { renderMailing } from './renderMailing.js';

/** A persistent channel job is claimed before network IO; acknowledgements use its lease. */
export class DeliverMailings {
  private running = false;
  constructor(private readonly deps: { repository: MailingRepository; transport: MailingTransport; appUrl: string; now: () => Date }) {}
  wake = (): void => { void this.run().catch(() => console.error('[mailings] queue iteration failed')); };
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.deps.repository.reconcile(this.deps.now());
      for (let n = 0; n < 20; n++) {
        const job = await this.deps.repository.claim(this.deps.now());
        if (!job) break;
        try {
          const campaign = await this.deps.repository.getCampaign(job.campaignId);
          if (!campaign || campaign.status === 'cancelled') {
            await this.deps.repository.finish(job, 'skipped', 'Рассылка отменена', this.deps.now()); continue;
          }
          if (!await this.deps.repository.recipientAvailable(job)) {
            await this.deps.repository.finish(job, 'skipped', 'Получатель удалён или недоступен', this.deps.now()); continue;
          }
          if (job.email && (await this.deps.repository.suppressed([job.email])).has(job.email)) {
            await this.deps.repository.finish(job, 'skipped', 'Получатель в стоп-листе', this.deps.now()); continue;
          }
          if (!this.deps.transport.channels[job.channel]) {
            await this.deps.repository.finish(job, 'failed', 'Канал отправки не настроен', this.deps.now()); continue;
          }
          const root = this.deps.appUrl.replace(/\/$/, '');
          const unsubscribe = job.email ? `${root}/api/mailings/unsubscribe/${job.token}` : '';
          const buttonUrl = job.content.buttonUrl ? `${root}/api/mailings/click/${job.token}` : '';
          const rendered = renderMailing(job.content, job, { unsubscribe, buttonUrl });
          const status = await this.deps.transport.send(job, rendered, unsubscribe);
          await this.deps.repository.finish(job, status, status === 'skipped' ? 'Канал недоступен получателю' : null, this.deps.now());
        } catch {
          await this.deps.repository.finish(job, 'failed', 'Не удалось отправить. Проверьте результат перед повтором', this.deps.now());
        }
      }
      await this.deps.repository.reconcile(this.deps.now());
    } finally { this.running = false; }
  }
}
