import type { MailingChannel, MailingJob, MailingPreview } from '../../domain/mailing/Mailing.js';
export interface MailingTransport {
  readonly channels: Record<MailingChannel, boolean>;
  send(job: MailingJob, rendered: MailingPreview, unsubscribeUrl: string): Promise<'sent' | 'skipped'>;
}
