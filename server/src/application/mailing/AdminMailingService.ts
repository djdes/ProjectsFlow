import {
  MAILING_CHANNELS, MailingError, mailingUrl, matchesAudience, matchesBase,
  normalizeMailingEmail, validateMailingContent,
  type AudienceFilters, type ContactFilters, type MailingAudience, type MailingContactInput,
  type MailingDraftInput, type MailingJob, type MailingSettings, type PlannedRecipient,
  type MailingReach,
} from '../../domain/mailing/Mailing.js';
import { previewContactsCsv } from '../../domain/mailing/csv.js';
import type { MailingActor, MailingRepository } from './MailingRepository.js';
import type { MailingTransport } from './MailingTransport.js';
import { renderMailing } from './renderMailing.js';

const BASES = [
  { id: 'users:all', title: 'Все пользователи', description: 'Пользователи ProjectsFlow, доступные для рассылки' },
  { id: 'users:free', title: 'Бесплатный тариф', description: 'Пользователи без действующей платной подписки' },
  { id: 'users:paid', title: 'Платящие пользователи', description: 'Действующие подписки Прайм и VIP' },
  { id: 'users:new', title: 'Новые за 30 дней', description: 'Пользователи, зарегистрировавшиеся за последние 30 дней' },
];
function admin(actor: MailingActor | null): asserts actor is MailingActor {
  if (!actor) throw new MailingError('unauthorized', 'Войдите в аккаунт', 401);
  if (!actor.isAdmin) throw new MailingError('forbidden', 'Доступно только администраторам', 403);
}
function draftInput(input: MailingDraftInput): MailingDraftInput {
  return {
    ...input, title: input.title.trim(), channels: [...new Set(input.channels)],
    content: { ...input.content, subject: input.content.subject.replace(/[\r\n]+/g, ' '), buttonUrl: input.content.buttonUrl.trim() },
    audience: { userIds: [...new Set(input.audience.userIds)], contactIds: [...new Set(input.audience.contactIds)], baseIds: [...new Set(input.audience.baseIds)] },
  };
}
export class AdminMailingService {
  constructor(private readonly deps: { repository: MailingRepository; transport: MailingTransport; now: () => Date; idGen: () => string }) {}

  async overview(actor: MailingActor | null) {
    admin(actor);
    const [users, contacts, settings, campaigns, sentToday] = await Promise.all([
      this.deps.repository.listUsers(), this.deps.repository.contactBases(), this.deps.repository.settings(),
      this.deps.repository.listCampaigns(), this.deps.repository.sentToday(this.deps.now()),
    ]);
    const bases = BASES.map(base => ({ ...base, total: users.filter(user => !user.suppressed && matchesBase(user, base.id, this.deps.now())).length }));
    bases.push(...contacts.map(base => ({ id: `contacts:${base.source}`, title: base.source, description: 'Загруженная база контактов', total: base.total })));
    return { settings, campaigns, sentToday, channels: this.deps.transport.channels, bases };
  }
  async audience(actor: MailingActor | null, filters: AudienceFilters, page: number) {
    admin(actor);
    const rows = (await this.deps.repository.listUsers()).filter(user => matchesAudience(user, filters));
    return { items: rows.slice((page - 1) * 50, page * 50), total: rows.length, page, pageSize: 50 };
  }
  async contacts(actor: MailingActor | null, filters: ContactFilters, page: number) {
    admin(actor); return this.deps.repository.listContacts(filters, page);
  }
  async importPreview(actor: MailingActor | null, text: string, source: string) {
    admin(actor); return previewContactsCsv(text, source);
  }
  async importContacts(actor: MailingActor | null, text: string, source: string) {
    admin(actor);
    const preview = previewContactsCsv(text, source);
    if (!preview.contacts.length) throw new MailingError('contacts_empty', 'В файле нет корректных email-адресов');
    const result = await this.deps.repository.importContacts(preview.contacts);
    return { ...result, duplicates: result.duplicates + preview.duplicates, invalid: preview.invalid.length };
  }
  async addContact(actor: MailingActor | null, input: MailingContactInput) {
    admin(actor);
    const email = normalizeMailingEmail(input.email);
    if (!email) throw new MailingError('email_invalid', 'Укажите корректный email');
    return this.deps.repository.importContacts([{ ...input, email }]);
  }
  async deleteContact(actor: MailingActor | null, id: string) { admin(actor); await this.deps.repository.deleteContact(id); }
  async stoplist(actor: MailingActor | null, search: string, page: number) { admin(actor); return this.deps.repository.listSuppressions(search, page); }
  async suppress(actor: MailingActor | null, raw: string) {
    admin(actor); const email = normalizeMailingEmail(raw);
    if (!email) throw new MailingError('email_invalid', 'Укажите корректный email');
    await this.deps.repository.suppress(email, 'manual');
  }
  async unsuppress(actor: MailingActor | null, raw: string) {
    admin(actor); const email = normalizeMailingEmail(raw);
    if (!email) throw new MailingError('email_invalid', 'Укажите корректный email');
    await this.deps.repository.unsuppress(email);
  }
  async settings(actor: MailingActor | null, value: MailingSettings) { admin(actor); await this.deps.repository.saveSettings(value); return value; }
  async save(actor: MailingActor | null, input: MailingDraftInput, id?: string, revision?: number) {
    admin(actor); const value = draftInput(input);
    if (id) return this.deps.repository.updateDraft(id, revision ?? -1, value, this.deps.now());
    return this.deps.repository.createDraft(value, actor, this.deps.now());
  }
  async details(actor: MailingActor | null, id: string, page = 1) {
    admin(actor);
    const campaign = await this.deps.repository.getCampaign(id);
    if (!campaign) throw new MailingError('not_found', 'Рассылка не найдена', 404);
    return { campaign, deliveries: await this.deps.repository.deliveries(id, page) };
  }
  async deleteDraft(actor: MailingActor | null, id: string) { admin(actor); await this.deps.repository.deleteDraft(id); }

  private async recipients(selection: MailingAudience, channels: MailingDraftInput['channels']) {
    for (const id of selection.baseIds) {
      if (!BASES.some(base => base.id === id) && !(id.startsWith('contacts:') && id.length > 9)) throw new MailingError('base_invalid', 'Неизвестная база получателей');
    }
    const [allUsers, contacts] = await Promise.all([this.deps.repository.listUsers(), this.deps.repository.resolveContacts(selection)]);
    const ids = new Set(selection.userIds);
    const users = allUsers.filter(user => ids.has(user.id) || selection.baseIds.some(base => matchesBase(user, base, this.deps.now())));
    const candidates = new Map<string, { recipient: PlannedRecipient; blocked: boolean; hasTelegram: boolean }>();
    for (const user of users) {
      const key = user.email ?? `user:${user.id}`;
      candidates.set(key, { recipient: { key, userId: user.id, contactId: null, email: user.email, name: user.name, company: user.company, channels: [] }, blocked: user.suppressed, hasTelegram: user.hasTelegram });
    }
    for (const contact of contacts) {
      if (candidates.has(contact.email)) continue;
      candidates.set(contact.email, { recipient: { key: contact.email, userId: null, contactId: contact.id, email: contact.email, name: contact.name, company: contact.company, channels: [] }, blocked: contact.suppressed || contact.status !== 'active', hasTelegram: false });
    }
    const suppressed = await this.deps.repository.suppressed([...candidates.values()].flatMap(item => item.recipient.email ? [item.recipient.email] : []));
    const recipients: PlannedRecipient[] = [];
    const reach: MailingReach = { recipients: 0, deliveries: 0, skipped: 0, byChannel: { email: 0, telegram: 0, site: 0 } };
    for (const { recipient, blocked, hasTelegram } of candidates.values()) {
      if (blocked || (recipient.email && suppressed.has(recipient.email))) { reach.skipped++; continue; }
      recipient.channels = MAILING_CHANNELS.filter(channel => channels.includes(channel) && this.deps.transport.channels[channel] && (channel === 'email' ? Boolean(recipient.email) : channel === 'site' ? Boolean(recipient.userId) : hasTelegram));
      if (!recipient.channels.length) { reach.skipped++; continue; }
      recipients.push(recipient); reach.recipients++;
      for (const channel of recipient.channels) { reach.deliveries++; reach.byChannel[channel]++; }
    }
    return { recipients, reach };
  }
  async reach(actor: MailingActor | null, input: MailingDraftInput) { admin(actor); return (await this.recipients(input.audience, input.channels)).reach; }
  async preview(actor: MailingActor | null, input: MailingDraftInput, userId?: string) {
    admin(actor); validateMailingContent(input.content);
    const recipient = userId ? (await this.deps.repository.listUsers()).find(user => user.id === userId) : undefined;
    if (userId && !recipient) throw new MailingError('not_found', 'Пользователь не найден', 404);
    return renderMailing(input.content, recipient ?? { name: actor.displayName, company: 'Ваша команда', email: actor.email });
  }
  async launch(actor: MailingActor | null, id: string, revision: number, scheduledAt: string | null) {
    admin(actor);
    const { campaign } = await this.details(actor, id);
    const parsedSchedule = scheduledAt ? new Date(scheduledAt) : null;
    if (parsedSchedule && !Number.isFinite(parsedSchedule.getTime())) throw new MailingError('schedule_invalid', 'Укажите корректное время запуска');
    if (campaign.status !== 'draft') return this.deps.repository.enqueue(id, revision, [], parsedSchedule, this.deps.now());
    validateMailingContent(campaign.content);
    if (campaign.channels.some(channel => !this.deps.transport.channels[channel])) throw new MailingError('channel_unavailable', 'Выбранный канал сейчас не настроен. Измените каналы рассылки', 503);
    if (!campaign.channels.length) throw new MailingError('channels_empty', 'Выберите хотя бы один канал');
    const when = scheduledAt ? new Date(scheduledAt) : null;
    if (when && (!Number.isFinite(when.getTime()) || when.getTime() < this.deps.now().getTime() + 60_000)) throw new MailingError('schedule_invalid', 'Выберите время не раньше чем через минуту');
    const { recipients } = await this.recipients(campaign.audience, campaign.channels);
    if (!recipients.length) throw new MailingError('audience_empty', 'Нет получателей для выбранных каналов. Проверьте базу и стоп-лист');
    return this.deps.repository.enqueue(id, revision, recipients, when, this.deps.now());
  }
  async cancel(actor: MailingActor | null, id: string) { admin(actor); await this.deps.repository.cancel(id, this.deps.now()); }
  async retry(actor: MailingActor | null, id: string) { admin(actor); await this.deps.repository.retry(id, this.deps.now()); }
  async test(actor: MailingActor | null, id: string) {
    admin(actor); const { campaign } = await this.details(actor, id); validateMailingContent(campaign.content);
    const rendered = renderMailing(campaign.content, { name: actor.displayName, company: 'Ваша команда', email: actor.email });
    const results: { channel: string; status: string; message: string }[] = [];
    for (const channel of campaign.channels) {
      if (!this.deps.transport.channels[channel]) { results.push({ channel, status: 'skipped', message: 'Канал не настроен' }); continue; }
      const job: MailingJob = { id: this.deps.idGen(), campaignId: id, userId: actor.id, contactId: null, email: normalizeMailingEmail(actor.email), name: actor.displayName, company: 'Ваша команда', channel, status: 'sending', error: null, attempts: 1, sentAt: null, clickedAt: null, token: '', lease: '', recipientKind: 'user', content: campaign.content };
      try {
        const status = await this.deps.transport.send(job, { ...rendered, subject: `[Тест] ${rendered.subject}` }, '');
        results.push({ channel, status, message: status === 'sent' ? 'Отправлено вам' : 'Ваш аккаунт не подключён к каналу' });
      } catch { results.push({ channel, status: 'failed', message: 'Не удалось отправить тест. Проверьте настройки канала' }); }
    }
    return results;
  }
  async unsubscribe(token: string) { return this.deps.repository.unsubscribe(token); }
  async click(token: string) {
    const url = await this.deps.repository.click(token, this.deps.now());
    return url ? mailingUrl(url) : null;
  }
}
