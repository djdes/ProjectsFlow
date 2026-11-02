import type {
  AudienceUser, ContactFilters, MailingAudience, MailingCampaign, MailingCampaignSummary, MailingContact,
  MailingContactInput, MailingDelivery, MailingDraftInput, MailingJob, MailingPage,
  MailingSettings, MailingSuppression, PlannedRecipient, DeliveryStatus,
} from '../../domain/mailing/Mailing.js';

export type MailingActor = { id: string; isAdmin: boolean; email: string; displayName: string };
export interface MailingRepository {
  listUsers(): Promise<AudienceUser[]>;
  listContacts(filters: ContactFilters, page: number): Promise<MailingPage<MailingContact>>;
  contactBases(): Promise<{ source: string; total: number }[]>;
  resolveContacts(selection: MailingAudience): Promise<MailingContact[]>;
  importContacts(contacts: MailingContactInput[]): Promise<{ inserted: number; duplicates: number }>;
  deleteContact(id: string): Promise<void>;
  listSuppressions(search: string, page: number): Promise<MailingPage<MailingSuppression>>;
  suppress(email: string, reason: MailingSuppression['reason']): Promise<void>;
  unsuppress(email: string): Promise<void>;
  suppressed(emails: string[]): Promise<Set<string>>;
  settings(): Promise<MailingSettings>;
  saveSettings(settings: MailingSettings): Promise<void>;
  sentToday(now: Date): Promise<number>;
  listCampaigns(): Promise<MailingCampaignSummary[]>;
  getCampaign(id: string): Promise<MailingCampaign | null>;
  createDraft(input: MailingDraftInput, actor: MailingActor, now: Date): Promise<MailingCampaign>;
  updateDraft(id: string, revision: number, input: MailingDraftInput, now: Date): Promise<MailingCampaign>;
  deleteDraft(id: string): Promise<void>;
  enqueue(id: string, revision: number, recipients: PlannedRecipient[], scheduledAt: Date | null, now: Date): Promise<MailingCampaign>;
  deliveries(id: string, page: number): Promise<MailingPage<MailingDelivery>>;
  cancel(id: string, now: Date): Promise<void>;
  retry(id: string, now: Date): Promise<void>;
  claim(now: Date): Promise<MailingJob | null>;
  recipientAvailable(job: MailingJob): Promise<boolean>;
  finish(job: MailingJob, status: Extract<DeliveryStatus, 'sent' | 'failed' | 'skipped'>, error: string | null, now: Date): Promise<void>;
  reconcile(now: Date): Promise<void>;
  unsubscribe(token: string): Promise<boolean>;
  click(token: string, now: Date): Promise<string | null>;
}
