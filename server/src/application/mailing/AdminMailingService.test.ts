import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeliverMailings } from './DeliverMailings.js';
import { MailingError } from '../../domain/mailing/Mailing.js';
import { ADMIN, INPUT, NOW, exampleJob, mailingHarness } from '../../../test/mailingHarness.js';

test('anonymous and non-admin users cannot read audience or save drafts', async () => {
  const h = mailingHarness();
  for (const actor of [null, { ...ADMIN, isAdmin: false }]) {
    await assert.rejects(() => h.service.overview(actor), (e: unknown) => e instanceof MailingError && e.status === (actor ? 403 : 401));
    await assert.rejects(() => h.service.audience(actor, {}, 1), MailingError);
    await assert.rejects(() => h.service.save(actor, INPUT), MailingError);
  }
  assert.equal(h.state.calls.length, 0);
});
test('audience union deduplicates users, contact bases and explicit IDs, excludes stoplist and unavailable channels', async () => {
  const h = mailingHarness();
  await h.service.addContact(ADMIN, { email: 'alex@example.com', name: 'Дубль', company: 'Компания', source: 'База' });
  await h.service.addContact(ADMIN, { email: 'blocked@example.com', name: 'Запрет', company: '', source: 'База' });
  await h.service.addContact(ADMIN, { email: 'only@example.com', name: 'Контакт', company: '', source: 'База' });
  h.state.blocked.add('blocked@example.com');
  const input = { ...INPUT, channels: ['email', 'telegram', 'site'] as const, audience: { userIds: ['u1'], contactIds: ['contact-0'], baseIds: ['users:all', 'contacts:База'] } };
  const reach = await h.service.reach(ADMIN, { ...input, channels: [...input.channels] });
  assert.deepEqual(reach, { recipients: 2, deliveries: 4, skipped: 1, byChannel: { email: 2, telegram: 1, site: 1 } });
});
test('draft saves preserve incomplete content; stale versions and sent drafts cannot be overwritten', async () => {
  const h = mailingHarness(); const saved = await h.service.save(ADMIN, { ...INPUT, content: { ...INPUT.content, body: '' } });
  assert.equal(saved.content.body, '');
  await h.service.save(ADMIN, INPUT, saved.id, saved.revision);
  await assert.rejects(() => h.service.save(ADMIN, INPUT, saved.id, saved.revision), (e: unknown) => e instanceof MailingError && e.status === 409);
  h.state.campaigns.get('campaign')!.status = 'sending';
  await assert.rejects(() => h.service.save(ADMIN, INPUT, 'campaign', 1), MailingError);
});
test('launch validates a fresh snapshot, scheduling, empty audience and unavailable configured channels', async () => {
  const h = mailingHarness();
  await assert.rejects(() => h.service.launch(ADMIN, 'campaign', 1, '2026-11-02T09:00:30Z'), /через минуту/);
  h.transport.channels.email = false;
  await assert.rejects(() => h.service.launch(ADMIN, 'campaign', 1, null), (e: unknown) => e instanceof MailingError && e.status === 503);
  h.transport.channels.email = true; h.state.blocked.add('alex@example.com');
  await assert.rejects(() => h.service.launch(ADMIN, 'campaign', 1, null), /Нет получателей/);
  h.state.blocked.clear(); const result = await h.service.launch(ADMIN, 'campaign', 1, '2026-11-03T10:00:00+03:00');
  assert.equal(result.status, 'scheduled'); assert.equal(result.scheduledAt, '2026-11-03T07:00:00.000Z'); assert.equal(h.state.jobs.length, 1);
});
test('repeat launch does not re-resolve a changed audience or resend accepted content', async () => {
  const h = mailingHarness();
  await h.service.launch(ADMIN, 'campaign', 1, null); h.state.blocked.add('alex@example.com');
  const result = await h.service.launch(ADMIN, 'campaign', 1, null);
  assert.equal(result.status, 'sending'); assert.equal(h.state.jobs.length, 1);
});
test('test delivery uses only the authenticated administrator, never campaign recipients', async () => {
  const h = mailingHarness(); const results = await h.service.test(ADMIN, 'campaign');
  assert.equal(results[0]!.status, 'sent'); assert.equal(h.state.sent[0]!.email, ADMIN.email); assert.equal(h.state.sent[0]!.userId, ADMIN.id);
  assert.equal(h.state.sent[0]!.token, ''); assert.equal(h.state.jobs.length, 0);
});
test('worker rechecks opt-outs, deletion and cancellation before any network delivery', async () => {
  for (const reason of ['suppressed', 'deleted', 'cancelled'] as const) {
    const h = mailingHarness(); h.state.campaigns.get('campaign')!.status = reason === 'cancelled' ? 'cancelled' : 'sending'; h.state.jobs.push(exampleJob());
    if (reason === 'suppressed') h.state.blocked.add('alex@example.com'); if (reason === 'deleted') h.state.available = false;
    await new DeliverMailings({ repository: h.repository, transport: h.transport, appUrl: 'https://projectsflow.ru', now: () => NOW }).run();
    assert.equal(h.state.sent.length, 0); assert.equal(h.state.finished[0]!.status, 'skipped');
  }
});
test('one failed channel does not discard independent successful jobs and raw transport errors stay private', async () => {
  const h = mailingHarness(); h.state.campaigns.get('campaign')!.status = 'sending';
  h.state.jobs.push(exampleJob({ id: 'email' }), exampleJob({ id: 'site', channel: 'site' }));
  h.transport.send = async job => { if (job.channel === 'email') throw new Error('SMTP password=private'); h.state.sent.push(job); return 'sent'; };
  await new DeliverMailings({ repository: h.repository, transport: h.transport, appUrl: 'https://projectsflow.ru', now: () => NOW }).run();
  assert.deepEqual(h.state.finished.map(row => row.status), ['failed', 'sent']);
  assert.doesNotMatch(h.state.finished[0]!.error!, /private|password/);
});
test('overlapping worker wakes cannot dispatch the same lease twice and links are generated from opaque job tokens', async () => {
  const h = mailingHarness(); h.state.campaigns.get('campaign')!.status = 'sending'; h.state.jobs.push(exampleJob());
  let finish!: () => void; const waiting = new Promise<void>(resolve => { finish = resolve; });
  h.transport.send = async (job, rendered, unsubscribe) => { h.state.sent.push(job); assert.match(rendered.buttonUrl, /\/api\/mailings\/click\/[a-f0-9]{64}$/); assert.match(unsubscribe, /\/unsubscribe\//); await waiting; return 'sent'; };
  const worker = new DeliverMailings({ repository: h.repository, transport: h.transport, appUrl: 'https://projectsflow.ru/', now: () => NOW });
  const first = worker.run(); await new Promise(resolve => setImmediate(resolve)); await worker.run();
  assert.equal(h.state.sent.length, 1); finish(); await first; assert.equal(h.state.finished[0]!.status, 'sent');
});
