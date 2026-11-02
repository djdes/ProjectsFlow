import type { MailingTransport } from '../../application/mailing/MailingTransport.js';
import type { MailingJob, MailingPreview } from '../../domain/mailing/Mailing.js';
import type { EmailSender } from '../../application/notifications/EmailSender.js';
import type { NotificationRepository } from '../../application/notifications/NotificationRepository.js';
import type { SendAgentTelegramNotification } from '../../application/telegram/SendAgentTelegramNotification.js';
import { escapeMailingHtml } from '../../application/mailing/renderMailing.js';

export class PlatformMailingTransport implements MailingTransport {
  readonly channels: { email: boolean; telegram: boolean; site: boolean };
  constructor(private readonly deps: {
    email: EmailSender; emailConfigured: boolean;
    notifications: Pick<NotificationRepository, 'create'>;
    telegram: Pick<SendAgentTelegramNotification, 'execute'>; telegramConfigured: boolean;
  }) { this.channels = { email: deps.emailConfigured, telegram: deps.telegramConfigured, site: true }; }
  async send(job: MailingJob, rendered: MailingPreview, unsubscribeUrl: string): Promise<'sent' | 'skipped'> {
    if (job.channel === 'email') {
      if (!job.email) return 'skipped';
      await this.deps.email.send({ to: job.email, subject: rendered.subject, html: rendered.html, text: rendered.text,
        messageId: `<mailing-${job.id}@projectsflow.ru>`,
        ...(unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
      });
      return 'sent';
    }
    if (!job.userId) return 'skipped';
    if (job.channel === 'site') {
      try {
        await this.deps.notifications.create({ id: job.id, userId: job.userId, payload: {
          type: 'platform_message', campaignId: job.campaignId, title: rendered.subject,
          body: rendered.text.slice(0, 2000), url: rendered.buttonUrl || null,
        } });
      } catch (error) {
        const e = error as { code?: string; cause?: { code?: string } };
        if ((e.code ?? e.cause?.code) !== 'ER_DUP_ENTRY') throw error;
      }
      return 'sent';
    }
    const result = await this.deps.telegram.execute({ userId: job.userId, kind: 'platform_mailing', skipDedupCheck: true,
      parseMode: 'HTML', text: `<b>${escapeMailingHtml(rendered.subject)}</b>\n\n${escapeMailingHtml(rendered.text.slice(0, 3000).replace(/[\uD800-\uDBFF]$/, ''))}`,
      ...(rendered.buttonUrl ? { replyMarkup: { inline_keyboard: [[{ text: job.content.buttonText || 'Открыть', url: rendered.buttonUrl }]] } } : {}),
    });
    if (result.status === 'ok') return 'sent';
    if (['not_connected', 'not_started', 'pref_off', 'forbidden'].includes(result.status)) return 'skipped';
    throw new Error('mailing_telegram_delivery_failed');
  }
}
