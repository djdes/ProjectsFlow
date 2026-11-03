import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailMessage } from '../notifications/EmailSender.js';
import type { CreateCampaignResult, MailingRepository, NewMailingCampaign } from './MailingRepository.js';
import {
  emptyMailingCounts,
  type MailingCampaign,
  type MailingCandidate,
  type MailingDelivery,
  type MailingRecipientStatus,
  type MailingTemplate,
} from '../../domain/mailing/Mailing.js';
import { RunMailingQueue, STALE_CLAIM_ERROR } from './RunMailingQueue.js';
import { MailingService } from './MailingService.js';
import { MailingError } from '../../domain/mailing/errors.js';

type Row = MailingCandidate & {
  campaignId: string; status: MailingRecipientStatus; attempts: number;
  nextAttemptAt: Date | null; lockedAt: Date | null; sentAt: Date | null; error: string | null;
};

// In-memory twin of MysqlMailingRepository with the same conditional transitions.
function fakeRepo(users: MailingCandidate[] = []) {
  const campaigns = new Map<string, NewMailingCampaign & { status: MailingCampaign['status']; createdAt: Date }>();
  const rows: Row[] = [];
  const unsubscribed = new Set<string>();
  const templates = new Map<string, MailingTemplate>();
  const toCampaign = (id: string): MailingCampaign | null => {
    const c = campaigns.get(id);
    if (!c) return null;
    const counts = emptyMailingCounts();
    for (const r of rows) if (r.campaignId === id) counts[r.status]++;
    return { id, templateId: c.templateId, name: c.name, content: c.content, audience: c.audience, status: c.status,
      totalCount: c.recipients.length, counts, createdBy: c.createdBy, createdAt: c.createdAt, finishedAt: null, cancelledAt: null };
  };
  const own = (d: MailingDelivery) => rows.find((r) => r.campaignId === d.campaignId && r.userId === d.userId
    && r.status === 'sending' && r.lockedAt?.getTime() === d.lockedAt.getTime());
  const repo: MailingRepository = {
    listTemplates: async () => [...templates.values()],
    getTemplate: async (id) => templates.get(id) ?? null,
    createTemplate: async () => { throw new Error('unused'); },
    updateTemplate: async () => null,
    deleteTemplate: async () => false,
    listWorkspaceOptions: async () => [],
    workspaceExists: async () => true,
    listAudienceCandidates: async () => users,
    listUnsubscribedUserIds: async () => new Set(unsubscribed),
    isUnsubscribed: async (id) => unsubscribed.has(id),
    unsubscribe: async (id) => { unsubscribed.add(id); return true; },
    findRecipient: async (id) => users.find((u) => u.userId === id) ?? null,
    createCampaign: async (input: NewMailingCampaign, now: Date): Promise<CreateCampaignResult> => {
      const existing = campaigns.get(input.id);
      if (existing) return { kind: 'exists', campaign: toCampaign(input.id)!, requestHash: existing.requestHash };
      campaigns.set(input.id, { ...input, status: 'sending', createdAt: now });
      for (const r of input.recipients) {
        rows.push({ ...r, campaignId: input.id, status: 'queued', attempts: 0, nextAttemptAt: null, lockedAt: null, sentAt: null, error: null });
      }
      return { kind: 'created', campaign: toCampaign(input.id)! };
    },
    listCampaigns: async () => [...campaigns.keys()].map((id) => toCampaign(id)!),
    getCampaign: async (id) => toCampaign(id),
    getCampaignRequestHash: async (id) => campaigns.get(id)?.requestHash ?? null,
    listRecipientProblems: async () => [],
    cancelCampaign: async (id) => {
      const c = campaigns.get(id);
      if (!c || c.status !== 'sending') return false;
      c.status = 'cancelled';
      for (const r of rows) if (r.campaignId === id && r.status === 'queued') r.status = 'cancelled';
      return true;
    },
    failStaleClaims: async (before, error) => {
      let n = 0;
      for (const r of rows) if (r.status === 'sending' && r.lockedAt! < before) { r.status = 'failed'; r.error = error; r.lockedAt = null; n++; }
      return n;
    },
    countSentSince: async (since) => rows.filter((r) => (r.status === 'sent' && r.sentAt! >= since) || r.status === 'sending').length,
    claimDue: async (now, limit) => {
      const due = rows.filter((r) => r.status === 'queued' && campaigns.get(r.campaignId)?.status === 'sending'
        && (!r.nextAttemptAt || r.nextAttemptAt <= now)).slice(0, limit);
      const lockedAt = new Date(Math.floor(now.getTime() / 1000) * 1000);
      return due.map((r) => {
        r.status = 'sending'; r.lockedAt = lockedAt; r.attempts++;
        return { ...r, lockedAt, content: campaigns.get(r.campaignId)!.content };
      });
    },
    markSent: async (d, now) => { const r = own(d); if (r) { r.status = 'sent'; r.sentAt = now; r.lockedAt = null; } },
    markRetry: async (d, at, error) => { const r = own(d); if (r) { r.status = 'queued'; r.nextAttemptAt = at; r.error = error; r.lockedAt = null; } },
    markFailed: async (d, error) => { const r = own(d); if (r) { r.status = 'failed'; r.error = error; r.lockedAt = null; } },
    markSkipped: async (d, reason) => { const r = own(d); if (r) { r.status = 'skipped'; r.error = reason; r.lockedAt = null; } },
    completeDrained: async () => {
      let n = 0;
      for (const [id, c] of campaigns) {
        if (c.status === 'sending' && !rows.some((r) => r.campaignId === id && (r.status === 'queued' || r.status === 'sending'))) { c.status = 'completed'; n++; }
      }
      return n;
    },
  };
  return { repo, rows, campaigns, unsubscribed, templates };
}

const people = (n: number): MailingCandidate[] => Array.from({ length: n }, (_, i) => ({
  userId: `u${i}`, email: `u${i}@example.com`, displayName: `Пользователь ${i}`, workspaceName: 'Команда',
}));

const content = { subject: 'Привет, {{name}}', preheader: 'Новости', bodyMarkdown: 'Текст для {{name}}', ctaLabel: null, ctaUrl: null };

function harness(users: MailingCandidate[], opts: { perMinute?: number; send?: (m: EmailMessage) => Promise<void> } = {}) {
  const fake = fakeRepo(users);
  let clock = new Date('2026-11-03T10:00:00Z');
  const sent: EmailMessage[] = [];
  const email = { send: async (m: EmailMessage) => { await opts.send?.(m); sent.push(m); } };
  const queue = new RunMailingQueue({
    repo: fake.repo, email, perMinute: opts.perMinute ?? 100,
    unsubscribeUrl: (id) => `https://projectsflow.ru/api/mailing/unsubscribe/${id}.sig`, now: () => clock,
  });
  const service = new MailingService({
    repo: fake.repo, email, appUrl: 'https://projectsflow.ru', tokenSecret: 'test-secret-0123456789',
    idGen: () => 'generated-id', now: () => clock,
  });
  fake.templates.set('tpl', { id: 'tpl', name: 'Новость', ...content, createdBy: 'admin', createdAt: clock, updatedAt: clock });
  const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };
  return { ...fake, queue, service, sent, advance };
}

const REQUEST = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('worker sends each recipient exactly once, personalized, with List-Unsubscribe; reruns are no-ops', async () => {
  const h = harness(people(3));
  await h.service.launch({ requestId: REQUEST, templateId: 'tpl', audience: { kind: 'all' }, expectedReach: 3 }, 'admin');
  await h.queue.run();
  await h.queue.run();
  h.advance(10 * 60_000);
  await h.queue.run();
  assert.equal(h.sent.length, 3);
  assert.deepEqual(h.sent.map((m) => m.to).sort(), ['u0@example.com', 'u1@example.com', 'u2@example.com']);
  assert.equal(h.sent[0]!.subject, 'Привет, Пользователь 0');
  assert.match(h.sent[0]!.html, /Отписаться от рассылок/);
  assert.equal(h.sent[0]!.headers?.['List-Unsubscribe'], '<https://projectsflow.ru/api/mailing/unsubscribe/u0.sig>');
  assert.equal(h.sent[0]!.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(h.campaigns.get(REQUEST)!.status, 'completed');
});

test('per-minute budget spreads the queue over time', async () => {
  const h = harness(people(5), { perMinute: 2 });
  await h.service.launch({ requestId: REQUEST, templateId: 'tpl', audience: { kind: 'all' }, expectedReach: 5 }, 'admin');
  await h.queue.run();
  await h.queue.run();
  assert.equal(h.sent.length, 2);
  h.advance(61_000);
  await h.queue.run();
  assert.equal(h.sent.length, 4);
});

test('transient errors retry with backoff; SMTP 5xx and exhausted attempts fail', async () => {
  let failures = 0;
  const h = harness(people(2), {
    send: async (m) => {
      if (m.to === 'u0@example.com' && failures++ < 1) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
      if (m.to === 'u1@example.com') throw Object.assign(new Error('mailbox unavailable'), { responseCode: 550 });
    },
  });
  await h.service.launch({ requestId: REQUEST, templateId: 'tpl', audience: { kind: 'all' }, expectedReach: 2 }, 'admin');
  const first = await h.queue.run();
  assert.deepEqual(first, { sent: 0, failed: 1, skipped: 0, retried: 1 });
  assert.equal(h.rows.find((r) => r.userId === 'u1')!.status, 'failed');
  await h.queue.run();
  assert.equal(h.sent.length, 0, 'not due before the retry delay');
  h.advance(61_000);
  await h.queue.run();
  assert.deepEqual(h.sent.map((m) => m.to), ['u0@example.com']);
  assert.equal(h.rows.find((r) => r.userId === 'u0')!.attempts, 2);
});

test('a claim left in sending after a crash is failed, never resent', async () => {
  const h = harness(people(1));
  await h.service.launch({ requestId: REQUEST, templateId: 'tpl', audience: { kind: 'all' }, expectedReach: 1 }, 'admin');
  await h.repo.claimDue(new Date('2026-11-03T10:00:00Z'), 10); // the process "died" here
  h.advance(11 * 60_000);
  await h.queue.run();
  assert.equal(h.sent.length, 0);
  const row = h.rows[0]!;
  assert.equal(row.status, 'failed');
  assert.equal(row.error, STALE_CLAIM_ERROR);
});

test('unsubscribing after launch skips the queued letter; cancel stops the rest', async () => {
  const h = harness(people(3), { perMinute: 1 });
  await h.service.launch({ requestId: REQUEST, templateId: 'tpl', audience: { kind: 'all' }, expectedReach: 3 }, 'admin');
  h.unsubscribed.add('u0');
  await h.queue.run();
  assert.equal(h.rows.find((r) => r.userId === 'u0')!.status, 'skipped');
  await h.service.cancel(REQUEST);
  h.advance(120_000);
  await h.queue.run();
  assert.equal(h.sent.length, 0);
  assert.deepEqual(h.rows.map((r) => r.status), ['skipped', 'cancelled', 'cancelled']);
});

test('launch is idempotent by request id and checks the confirmed reach', async () => {
  const h = harness(people(2));
  await assert.rejects(
    h.service.launch({ requestId: REQUEST, templateId: 'tpl', audience: { kind: 'all' }, expectedReach: 5 }, 'admin'),
    (e: unknown) => e instanceof MailingError && e.code === 'audience_changed',
  );
  const a = await h.service.launch({ requestId: REQUEST, templateId: 'tpl', audience: { kind: 'all' }, expectedReach: 2 }, 'admin');
  const b = await h.service.launch({ requestId: REQUEST, templateId: 'tpl', audience: { kind: 'all' }, expectedReach: 2 }, 'admin');
  assert.equal(a.id, b.id);
  assert.equal(h.rows.length, 2);
  await assert.rejects(
    h.service.launch({ requestId: REQUEST, templateId: 'tpl', audience: { kind: 'plan', plans: ['vip'] }, expectedReach: 2 }, 'admin'),
    (e: unknown) => e instanceof MailingError && e.code === 'request_conflict',
  );
});

test('test send goes only to the admin, marked as a test, and is rate limited', async () => {
  const h = harness(people(3));
  const admin = { id: 'u1', email: 'u1@example.com', displayName: 'Пользователь 1' };
  const r = await h.service.sendTest(content, admin);
  assert.equal(r.to, 'u1@example.com');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0]!.subject, '[Тест] Привет, Пользователь 1');
  await assert.rejects(h.service.sendTest(content, admin), (e: unknown) => e instanceof MailingError && e.code === 'test_rate_limited');
  assert.equal(h.rows.length, 0, 'a test does not touch the campaign queue');
});
