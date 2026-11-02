import type { MailingRepository, MailingActor } from '../src/application/mailing/MailingRepository.js';
import type { MailingTransport } from '../src/application/mailing/MailingTransport.js';
import { AdminMailingService } from '../src/application/mailing/AdminMailingService.js';
import { MailingError, emptyMailingCounts, type AudienceUser, type MailingCampaign, type MailingContact, type MailingDraftInput, type MailingJob, type MailingPage, type MailingSettings } from '../src/domain/mailing/Mailing.js';
export const NOW = new Date('2026-11-02T09:00:00.000Z');
export const ADMIN: MailingActor = { id: 'admin', email: 'admin@example.com', displayName: 'Администратор', isAdmin: true };
export const INPUT: MailingDraftInput = { title: 'Новости команды', content: { kind: 'news', subject: 'Здравствуйте, {имя}', preheader: 'Новости', body: 'Новости для {компания}. **Добро пожаловать**', buttonText: 'Открыть', buttonUrl: 'https://projectsflow.ru/' }, channels: ['email'], audience: { userIds: ['u1'], contactIds: [], baseIds: [] } };
export function exampleCampaign(patch: Partial<MailingCampaign> = {}): MailingCampaign {
  return { ...structuredClone(INPUT), id: 'campaign', revision: 1, status: 'draft', createdById: ADMIN.id, createdByName: ADMIN.displayName, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), scheduledAt: null, startedAt: null, finishedAt: null, counts: emptyMailingCounts(), ...patch };
}
export function exampleJob(patch: Partial<MailingJob> = {}): MailingJob {
  return { id: 'delivery', campaignId: 'campaign', userId: 'u1', contactId: null, email: 'alex@example.com', name: 'Алексей', company: 'Команда', channel: 'email', status: 'sending', error: null, attempts: 1, sentAt: null, clickedAt: null, token: 'a'.repeat(64), lease: 'lease', content: structuredClone(INPUT.content), recipientKind: 'user', ...patch };
}
const paged = <T>(items: T[], page = 1): MailingPage<T> => ({ items: items.slice((page - 1) * 50, page * 50), total: items.length, page, pageSize: 50 });
export function mailingHarness() {
  const state = {
    campaigns: new Map<string, MailingCampaign>([['campaign', exampleCampaign()]]),
    users: [{ id: 'u1', email: 'alex@example.com', name: 'Алексей', company: 'Команда', plan: 'free', hasTelegram: true, suppressed: false, createdAt: '2026-10-20T09:00:00Z' }] as AudienceUser[],
    contacts: [] as MailingContact[], blocked: new Set<string>(), jobs: [] as MailingJob[], available: true,
    settings: { enabled: true, perMinute: 30, perDay: 1000 } as MailingSettings,
    calls: [] as { name: string; args: unknown[] }[], sent: [] as MailingJob[], finished: [] as { id: string; status: string; error: string | null }[],
  };
  const note = (name: string, ...args: unknown[]) => { state.calls.push({ name, args }); };
  const repository: MailingRepository = {
    listUsers: async () => { note('users'); return state.users.map(user => ({ ...user, suppressed: user.suppressed || Boolean(user.email && state.blocked.has(user.email)) })); },
    listContacts: async (_filters, page) => paged(state.contacts, page),
    contactBases: async () => [...new Set(state.contacts.map(c => c.source))].map(source => ({ source, total: state.contacts.filter(c => c.source === source && c.status === 'active').length })),
    resolveContacts: async selection => state.contacts.filter(c => selection.contactIds.includes(c.id) || selection.baseIds.includes(`contacts:${c.source}`)),
    importContacts: async rows => { let inserted = 0; for (const row of rows) if (!state.contacts.some(c => c.email === row.email)) { state.contacts.push({ ...row, id: `contact-${state.contacts.length}`, status: 'active', createdAt: NOW.toISOString(), suppressed: state.blocked.has(row.email) }); inserted++; } return { inserted, duplicates: rows.length - inserted }; },
    deleteContact: async id => { state.contacts = state.contacts.filter(c => c.id !== id); },
    listSuppressions: async (_search, page) => paged([...state.blocked].map(email => ({ email, reason: 'manual' as const, createdAt: NOW.toISOString() })), page),
    suppress: async email => { state.blocked.add(email); }, unsuppress: async email => { state.blocked.delete(email); },
    suppressed: async emails => new Set(emails.filter(email => state.blocked.has(email))),
    settings: async () => state.settings, saveSettings: async value => { state.settings = value; }, sentToday: async () => state.sent.length,
    listCampaigns: async () => [...state.campaigns.values()].map(c => { const { content: _content, audience: _audience, ...summary } = c; return summary; }),
    getCampaign: async id => state.campaigns.has(id) ? structuredClone(state.campaigns.get(id)!) : null,
    createDraft: async (input, actor) => { const value = exampleCampaign({ ...structuredClone(input), id: `new-${state.campaigns.size}`, createdById: actor.id, createdByName: actor.displayName }); state.campaigns.set(value.id, value); note('create', input); return structuredClone(value); },
    updateDraft: async (id, revision, input) => { const value = state.campaigns.get(id); if (!value || value.status !== 'draft' || value.revision !== revision) throw new MailingError('conflict', 'Черновик изменён', 409); Object.assign(value, structuredClone(input), { revision: revision + 1 }); note('update', id); return structuredClone(value); },
    deleteDraft: async id => { if (state.campaigns.get(id)?.status !== 'draft') throw new MailingError('conflict', 'Только черновик', 409); state.campaigns.delete(id); },
    enqueue: async (id, revision, recipients, scheduledAt) => { note('enqueue', id, revision, recipients, scheduledAt); const value = state.campaigns.get(id)!; if (value.status !== 'draft') return structuredClone(value); if (value.revision !== revision) throw new MailingError('conflict', 'Черновик изменён', 409); value.status = scheduledAt ? 'scheduled' : 'sending'; value.scheduledAt = scheduledAt?.toISOString() ?? null; value.revision++; for (const recipient of recipients) for (const channel of recipient.channels) state.jobs.push(exampleJob({ ...recipient, channel, id: `delivery-${state.jobs.length}`, campaignId: id, recipientKind: recipient.userId ? 'user' : 'contact' })); return structuredClone(value); },
    deliveries: async (id, page) => paged(state.jobs.filter(j => j.campaignId === id), page),
    cancel: async id => { state.campaigns.get(id)!.status = 'cancelled'; }, retry: async id => { state.campaigns.get(id)!.status = 'sending'; },
    claim: async () => state.settings.enabled ? state.jobs.shift() ?? null : null,
    recipientAvailable: async () => state.available,
    finish: async (job, status, error) => { state.finished.push({ id: job.id, status, error }); },
    reconcile: async () => {}, unsubscribe: async token => { if (token !== 'a'.repeat(64)) return false; state.blocked.add('alex@example.com'); return true; },
    click: async token => token === 'a'.repeat(64) ? INPUT.content.buttonUrl : null,
  };
  const transport: MailingTransport = { channels: { email: true, site: true, telegram: true }, send: async job => { state.sent.push(job); return 'sent'; } };
  const service = new AdminMailingService({ repository, transport, now: () => NOW, idGen: () => 'test-delivery' });
  return { state, repository, transport, service };
}
