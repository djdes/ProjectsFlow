import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramGroupOnboarding, type OnboardingPromptInput } from './TelegramGroupOnboarding.js';
import type {
  GroupOnboarding,
  TelegramGroupOnboardingRepository,
  TelegramLinkOutcome,
} from './TelegramGroupOnboardingRepository.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import type { CreateWorkspaceInviteInput } from '../workspace/WorkspaceInviteRepository.js';

const NOW = new Date('2026-11-12T10:00:00Z');

function harness(opts: { linkedUsers?: Record<number, string>; members?: string[]; link?: TelegramLinkOutcome } = {}) {
  let clock = NOW;
  const rows = new Map<string, GroupOnboarding>();
  const sent: Array<{ chatId: number; text: string; replyMarkup?: any; replyToMessageId?: number }> = [];
  const answers: Array<{ id: string; text?: string; showAlert?: boolean }> = [];
  const invites: WorkspaceInvite[] = [];
  const added: Array<{ workspaceId: string; userId: string; role: string }> = [];
  const started: Array<{ tgUserId: number; chatId: number; text: string; sourceKey: string }> = [];
  const links: Array<{ userId: string; tgId: number; username: string | null }> = [];
  const members = new Set(opts.members ?? []);
  let ids = 0;

  const repo: TelegramGroupOnboardingRepository = {
    async findOpen(tgChatId, tgUserId, now) {
      return [...rows.values()].find((r) => r.tgChatId === tgChatId && r.tgUserId === tgUserId && r.status !== 'completed' && r.expiresAt > now) ?? null;
    },
    async getById(id) { return rows.get(id) ?? null; },
    async findByInvite(inviteId) { return [...rows.values()].find((r) => r.inviteId === inviteId) ?? null; },
    async create(o) { rows.set(o.id, o); },
    async update(id, patch) { const r = rows.get(id); if (r) rows.set(id, { ...r, ...patch }); },
    async claimCompletion(id) {
      const r = rows.get(id);
      if (!r || r.status === 'completed') return false;
      rows.set(id, { ...r, status: 'completed' });
      return true;
    },
    async linkTelegram(userId, tg) {
      links.push({ userId, tgId: tg.id, username: tg.username });
      return opts.link ?? 'connected';
    },
  };

  const service = new TelegramGroupOnboarding({
    repo,
    users: { async findUserIdByTelegramUserId(id) { return opts.linkedUsers?.[id] ?? null; } },
    workspaces: {
      async getById(id) { return id === 'ws1' ? { id, name: 'Программисты', kind: 'team' as const, ownerUserId: 'owner' } : null; },
      async getMembership(workspaceId, userId) {
        return members.has(userId) ? { workspaceId, userId, role: 'editor' as const, displayName: null, email: null, avatarUrl: null } : null;
      },
      async addMember(workspaceId, userId, role) { members.add(userId); added.push({ workspaceId, userId, role }); },
    },
    invites: {
      async create(input: CreateWorkspaceInviteInput) {
        const invite = { ...input, excludedProjectIds: [], acceptedAt: null, acceptedByUserId: null, createdAt: NOW, delivery: null, deliveryAttempts: 0, deliveryNextAttemptAt: null, deliveryLockedAt: null, lastSentAt: null } as WorkspaceInvite;
        invites.push(invite);
        return invite;
      },
      async getById(id) { return invites.find((i) => i.id === id) ?? null; },
    },
    client: {
      async sendMessage(input) { sent.push({ chatId: input.chatId, text: input.text, replyMarkup: input.replyMarkup, replyToMessageId: input.replyToMessageId }); return { kind: 'ok' as const, messageId: sent.length }; },
      async answerCallbackQuery(id, o) { answers.push({ id, ...o }); },
    },
    appUrl: 'https://pf.test',
    botUsername: 'ProjectsFlow_Bot',
    shortIdGen: () => `onb${String(++ids).padStart(9, '0')}`,
    idGen: () => `inv-${++ids}`,
    randomToken: () => 'tok'.padEnd(64, '0'),
    now: () => clock,
    startTask: async (input) => { started.push({ tgUserId: input.tgUserId, chatId: input.chatId, text: input.text, sourceKey: input.sourceKey }); },
  });

  const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };
  return { service, rows, sent, answers, invites, added, started, links, advance };
}

const prompt = (patch: Partial<OnboardingPromptInput> = {}): OnboardingPromptInput => ({
  chatId: -1001,
  groupTitle: 'Команда',
  workspaceId: 'ws1',
  workspaceName: 'Программисты',
  tgUserId: 777,
  senderName: 'Иван',
  text: 'Сделать отчёт',
  sourceKey: 'm:-1001:1',
  replyToMessageId: 1,
  linkedUserId: null,
  ...patch,
});

test('prompt: unlinked sender gets 3 steps and a deep-link button; the text waits', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  assert.equal(h.sent.length, 1);
  const msg = h.sent[0]!;
  assert.equal(msg.chatId, -1001);
  assert.equal(msg.replyToMessageId, 1);
  assert.match(msg.text, /1️⃣/);
  assert.match(msg.text, /3️⃣/);
  assert.match(msg.text, /Программисты/);
  const button = msg.replyMarkup.inline_keyboard[0][0];
  const row = [...h.rows.values()][0]!;
  assert.equal(button.url, `https://t.me/ProjectsFlow_Bot?start=wj_${row.id}`);
  assert.match(row.id, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(row.pendingText, 'Сделать отчёт');
});

test('prompt: a second message within 10 minutes is appended with a short reply', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  h.advance(60_000);
  await h.service.prompt(prompt({ text: 'И презентацию', sourceKey: 'm:-1001:2', replyToMessageId: 2 }));
  assert.equal(h.rows.size, 1);
  assert.equal([...h.rows.values()][0]!.pendingText, 'Сделать отчёт\n\nИ презентацию');
  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1]!.text, /Запомнил/);
  assert.equal(h.sent[1]!.replyMarkup, undefined);
});

test('prompt: the same Telegram delivery twice changes nothing', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  await h.service.prompt(prompt());
  assert.equal([...h.rows.values()][0]!.pendingText, 'Сделать отчёт');
  assert.equal(h.sent.length, 1);
});

test('prompt: linked non-member gets a join callback button', async () => {
  const h = harness();
  await h.service.prompt(prompt({ linkedUserId: 'u-ivan' }));
  const row = [...h.rows.values()][0]!;
  const button = h.sent[0]!.replyMarkup.inline_keyboard[0][0];
  assert.equal(button.callback_data, `wj:${row.id}`);
  assert.match(button.text, /Вступить/);
});

test('handlePrivateStart: another Telegram user cannot use the button', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  const row = [...h.rows.values()][0]!;
  await h.service.handlePrivateStart({ id: row.id, chatId: 888, from: { id: 888 } });
  assert.equal(h.invites.length, 0);
  assert.match(h.sent.at(-1)!.text, /для другого участника/);
});

test('handlePrivateStart: unlinked author gets a personal editor invite link', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  const row = [...h.rows.values()][0]!;
  await h.service.handlePrivateStart({ id: row.id, chatId: 777, from: { id: 777, username: 'ivan', first_name: 'Иван' } });
  assert.equal(h.invites.length, 1);
  const invite = h.invites[0]!;
  assert.equal(invite.role, 'editor');
  assert.equal(invite.email, null);
  assert.equal(invite.workspaceId, 'ws1');
  assert.equal(invite.expiresAt.getTime() - NOW.getTime(), 7 * 24 * 3600 * 1000);
  const dm = h.sent.at(-1)!;
  assert.equal(dm.chatId, 777);
  assert.equal(dm.replyMarkup.inline_keyboard[0][0].url, `https://pf.test/invite/${invite.token}`);
  const updated = h.rows.get(row.id)!;
  assert.equal(updated.status, 'invited');
  assert.equal(updated.inviteId, invite.id);
  assert.equal(updated.tgUsername, 'ivan');
  // Повторный /start не плодит приглашения.
  await h.service.handlePrivateStart({ id: row.id, chatId: 777, from: { id: 777 } });
  assert.equal(h.invites.length, 1);
});

test('handlePrivateStart: linked author joins as editor and the task is created', async () => {
  const h = harness({ linkedUsers: { 777: 'u-ivan' } });
  await h.service.prompt(prompt({ linkedUserId: 'u-ivan' }));
  const row = [...h.rows.values()][0]!;
  await h.service.handlePrivateStart({ id: row.id, chatId: 777, from: { id: 777 } });
  assert.deepEqual(h.added, [{ workspaceId: 'ws1', userId: 'u-ivan', role: 'editor' }]);
  assert.deepEqual(h.started, [{ tgUserId: 777, chatId: -1001, text: 'Сделать отчёт', sourceKey: `ob:${row.id}` }]);
  assert.equal(h.rows.get(row.id)!.status, 'completed');
});

test('handleJoinCallback: only the author can join; then the task is created once', async () => {
  const h = harness({ linkedUsers: { 777: 'u-ivan', 888: 'u-petr' } });
  await h.service.prompt(prompt({ linkedUserId: 'u-ivan' }));
  const row = [...h.rows.values()][0]!;
  await h.service.handleJoinCallback({ id: 'cq1', from: { id: 888 }, data: `wj:${row.id}` }, row.id);
  assert.equal(h.answers[0]!.showAlert, true);
  assert.equal(h.added.length, 0);
  await h.service.handleJoinCallback({ id: 'cq2', from: { id: 777 }, data: `wj:${row.id}` }, row.id);
  await h.service.handleJoinCallback({ id: 'cq3', from: { id: 777 }, data: `wj:${row.id}` }, row.id);
  assert.deepEqual(h.added, [{ workspaceId: 'ws1', userId: 'u-ivan', role: 'editor' }]);
  assert.equal(h.started.length, 1);
});

test('completeFromInvite: links Telegram, creates the waiting task, second call is a no-op', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  const row = [...h.rows.values()][0]!;
  await h.service.handlePrivateStart({ id: row.id, chatId: 777, from: { id: 777, username: 'ivan' } });
  const inviteId = h.invites[0]!.id;
  const result = await h.service.completeFromInvite({ inviteId, userId: 'u-new' });
  assert.deepEqual(result, { telegram: 'linked' });
  assert.deepEqual(h.links, [{ userId: 'u-new', tgId: 777, username: 'ivan' }]);
  assert.deepEqual(h.started, [{ tgUserId: 777, chatId: -1001, text: 'Сделать отчёт', sourceKey: `ob:${row.id}` }]);
  assert.ok(h.sent.some((m) => m.chatId === 777 && /Готово/.test(m.text)));
  assert.deepEqual(await h.service.completeFromInvite({ inviteId, userId: 'u-new' }), { telegram: null });
  assert.equal(h.started.length, 1);
});

test('completeFromInvite: Telegram of another account → joins, no task, explains', async () => {
  const h = harness({ link: 'conflict' });
  await h.service.prompt(prompt());
  const row = [...h.rows.values()][0]!;
  await h.service.handlePrivateStart({ id: row.id, chatId: 777, from: { id: 777 } });
  const result = await h.service.completeFromInvite({ inviteId: h.invites[0]!.id, userId: 'u-new' });
  assert.deepEqual(result, { telegram: 'conflict' });
  assert.equal(h.started.length, 0);
  assert.ok(h.sent.some((m) => m.chatId === 777 && /другому аккаунту/.test(m.text)));
});

test('completeFromInvite: unknown invite → nothing happens', async () => {
  const h = harness();
  assert.deepEqual(await h.service.completeFromInvite({ inviteId: 'x', userId: 'u' }), { telegram: null });
});
