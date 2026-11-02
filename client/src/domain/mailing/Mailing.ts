export const MAILING_CHANNELS = ['email', 'telegram', 'site'] as const;
export type MailingChannel = typeof MAILING_CHANNELS[number];
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'done' | 'cancelled';
export type DeliveryStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | 'cancelled';
export type ContactStatus = 'active' | 'unsubscribed' | 'bounced';
export type MailingContent = {
  kind: 'message' | 'news' | 'offer';
  subject: string;
  preheader: string;
  body: string;
  buttonText: string;
  buttonUrl: string;
};
export type MailingAudience = { userIds: string[]; contactIds: string[]; baseIds: string[] };
export type MailingDraftInput = { title: string; content: MailingContent; channels: MailingChannel[]; audience: MailingAudience };
export type MailingCounts = Record<DeliveryStatus, number> & { total: number; clicks: number };
export type MailingCampaign = MailingDraftInput & {
  id: string; revision: number; status: CampaignStatus; createdById: string | null;
  createdByName: string; createdAt: string; updatedAt: string;
  scheduledAt: string | null; startedAt: string | null; finishedAt: string | null;
  counts: MailingCounts;
};
export type MailingCampaignSummary = Omit<MailingCampaign, 'content' | 'audience'>;
export type AudienceUser = {
  id: string; name: string; email: string | null; company: string;
  plan: 'free' | 'prime' | 'vip'; hasTelegram: boolean; createdAt: string; suppressed: boolean;
};
export type AudienceFilters = {
  search?: string; plan?: 'all' | 'free' | 'prime' | 'vip';
  registeredFrom?: string; registeredTo?: string; hasTelegram?: boolean;
};
export type MailingContact = {
  id: string; email: string; name: string; company: string; source: string;
  status: ContactStatus; createdAt: string; suppressed: boolean;
};
export type ContactFilters = { search?: string; source?: string; status?: ContactStatus | 'all' };
export type MailingContactInput = Pick<MailingContact, 'email' | 'name' | 'company' | 'source'>;
export type MailingSuppression = { email: string; reason: 'manual' | 'unsubscribed' | 'bounced'; createdAt: string };
export type MailingSettings = { enabled: boolean; perMinute: number; perDay: number };
export type MailingBase = { id: string; title: string; description: string; total: number };
export type MailingPage<T> = { items: T[]; total: number; page: number; pageSize: number };
export type PlannedRecipient = { key: string; userId: string | null; contactId: string | null; email: string | null; name: string; company: string; channels: MailingChannel[] };
export type MailingReach = { recipients: number; deliveries: number; skipped: number; byChannel: Record<MailingChannel, number> };
export type MailingPreview = { subject: string; html: string; text: string; buttonUrl: string };
export type MailingDelivery = {
  id: string; campaignId: string; userId: string | null; contactId: string | null;
  email: string | null; name: string; company: string; channel: MailingChannel;
  status: DeliveryStatus; error: string | null; attempts: number;
  sentAt: string | null; clickedAt: string | null;
};
export type MailingJob = MailingDelivery & {
  content: MailingContent; token: string; lease: string; recipientKind: 'user' | 'contact';
};
export type MailingDetails = { campaign: MailingCampaign; deliveries: MailingPage<MailingDelivery> };
export type MailingOverview = {
  settings: MailingSettings; channels: Record<MailingChannel, boolean>;
  bases: MailingBase[]; campaigns: MailingCampaignSummary[]; sentToday: number;
};
export type CsvImportPreview = {
  contacts: MailingContactInput[]; invalid: { row: number; message: string }[];
  duplicates: number; total: number;
};
export class MailingError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}
export function emptyMailingCounts(): MailingCounts {
  return { total: 0, queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, cancelled: 0, clicks: 0 };
}
export function normalizeMailingEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) &&
    !/\.(?:local|invalid|test)$/.test(email) ? email : null;
}
export function mailingUrl(value: string): string | null {
  if (!value.trim()) return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function validateMailingContent(content: MailingContent): void {
  if (!content.subject.trim() || !content.body.trim()) throw new MailingError('content_required', 'Заполните тему и текст рассылки');
  if (content.buttonUrl && (!content.buttonText.trim() || mailingUrl(content.buttonUrl) === null)) {
    throw new MailingError('button_invalid', 'Укажите подпись кнопки и полный адрес http:// или https://');
  }
  if (content.buttonText.trim() && !content.buttonUrl.trim()) throw new MailingError('button_invalid', 'Укажите адрес кнопки');
}
export function matchesAudience(user: AudienceUser, filters: AudienceFilters): boolean {
  const needle = (filters.search ?? '').trim().toLocaleLowerCase('ru').replace(/ё/g, 'е');
  if (needle && ![user.name, user.email ?? '', user.company].join(' ').toLocaleLowerCase('ru').replace(/ё/g, 'е').includes(needle)) return false;
  if (filters.plan && filters.plan !== 'all' && user.plan !== filters.plan) return false;
  if (filters.hasTelegram && !user.hasTelegram) return false;
  const created = Date.parse(user.createdAt);
  if (filters.registeredFrom && created < Date.parse(`${filters.registeredFrom}T00:00:00+03:00`)) return false;
  if (filters.registeredTo && created >= Date.parse(`${filters.registeredTo}T00:00:00+03:00`) + 86_400_000) return false;
  return true;
}
export function matchesBase(user: AudienceUser, baseId: string, now: Date): boolean {
  return baseId === 'users:all' || (baseId === 'users:paid' && user.plan !== 'free') ||
    (baseId === 'users:free' && user.plan === 'free') ||
    (baseId === 'users:new' && Date.parse(user.createdAt) >= now.getTime() - 30 * 86_400_000);
}
