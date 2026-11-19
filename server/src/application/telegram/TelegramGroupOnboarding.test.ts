import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramGroupOnboarding, type OnboardingPromptInput } from './TelegramGroupOnboarding.js';
import type { GroupOnboarding, TelegramGroupOnboardingRepository } from './TelegramGroupOnboardingRepository.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import type { CreateWorkspaceInviteInput } from '../workspace/WorkspaceInviteRepository.js';
import { WorkspaceInviteExpiredError, WorkspaceRejoinBlockedError } from '../../domain/workspace/errors.js';

const NOW = new Date('2026-11-12T10:00:00Z');

function harness(
  opts: {
    linkedUsers?: Record<number, string>;
    accountTelegram?: Record<string, number>;
    members?: string[];
    removed?: string[];
    boundWorkspace?: string | null;
  } = {},
) {
  let clock = NOW;
  const rows = new Map<string, GroupOnboarding>();
  const sent: Array<{ chatId: number; text: string; replyMarkup?: any; replyToMessageId?: number }> = [];
  const answers: Array<{ id: string; text?: string; showAlert?: boolean }> = [];
  const invites: WorkspaceInvite[] = [];
  const deleted: string[] = [];
  const added: Array<{ workspaceId: string; userId: string; role: string }> = [];
  const started: Array<{ tgUserId: number; chatId: number; text: string; sourceKey: string }> = [];
  const pairings: string[] = [];
  const members = new Set(opts.members ?? []);
  let bound: string | null = opts.boundWorkspace === undefined ? 'ws1' : opts.boundWorkspace;
  let ids = 0;
  const open = (r: GroupOnboarding) => r.status === 'pending' || r.status === 'invited';

  const repo: TelegramGroupOnboardingRepository = {
    async findOpen(tgChatId, tgUserId, now) {
      return [...rows.values()].find((r) => r.tgChatId === tgChatId && r.tgUserId === tgUserId && open(r) && r.expiresAt > now) ?? null;
    },
    async listOpenForTelegramUser(tgUserId, now) {
      return [...rows.values()].filter((r) => r.tgUserId === tgUserId && open(r) && r.expiresAt > now);
    },
    async getById(id) { return rows.get(id) ?? null; },
    async findByInvite(inviteId) { return [...rows.values()].find((r) => r.inviteId === inviteId) ?? null; },
    async create(o) { rows.set(o.id, o); },
    async update(id, patch) { const r = rows.get(id); if (r) rows.set(id, { ...r, ...patch }); },
    async setInviteIfAbsent(id, inviteId) {
      const r = rows.get(id);
      if (r && r.inviteId === null && open(r)) rows.set(id, { ...r, inviteId, status: 'invited' });
      return rows.get(id)?.inviteId ?? null;
    },
    async claimCompletion(id) {
      const r = rows.get(id);
      if (!r || !open(r)) return false;
      rows.set(id, { ...r, status: 'completed' });
      return true;
    },
    async cancelOpenForGroup(workspaceId, tgChatId) {
      const out: string[] = [];
      for (const r of rows.values()) {
        if (r.workspaceId === workspaceId && r.tgChatId === tgChatId && open(r)) {
          if (r.inviteId) out.push(r.inviteId);
          rows.set(r.id, { ...r, status: 'cancelled' });
        }
      }
      return out;
    },
  };

  const service = new TelegramGroupOnboarding({
    repo,
    users: {
      async findUserIdByTelegramUserId(id) { return opts.linkedUsers?.[id] ?? null; },
      async getTelegramLink(userId) {
        const tg = opts.accountTelegram?.[userId];
        return tg === undefined ? null : { telegramUserId: tg };
      },
    },
    workspaces: {
      async getById(id) { return id === 'ws1' || id === 'ws2' ? { id, name: id === 'ws1' ? 'Программисты' : 'Офис', kind: 'team' as const, ownerUserId: 'owner' } : null; },
      async getMembership(workspaceId, userId) {
        return members.has(userId) ? { workspaceId, userId, role: 'editor' as const, displayName: null, email: null, avatarUrl: null } : null;
      },
      async addMember(workspaceId, userId, role) { members.add(userId); added.push({ workspaceId, userId, role }); },
      async wasRemoved(_workspaceId, userId) { return (opts.removed ?? []).includes(userId); },
    },
    invites: {
      async create(input: CreateWorkspaceInviteInput) {
        const invite = { ...input, excludedProjectIds: [], acceptedAt: null, acceptedByUserId: null, createdAt: NOW, delivery: null, deliveryAttempts: 0, deliveryNextAttemptAt: null, deliveryLockedAt: null, lastSentAt: null } as WorkspaceInvite;
        invites.push(invite);
        return invite;
      },
      async getById(id) { return invites.find((i) => i.id === id) ?? null; },
      async delete(id) { deleted.push(id); return true; },
    },
    workGroups: { async resolveChat() { return bound ? { workspaceId: bound } : null; } },
    pairing: {
      async start(userId) {
        pairings.push(userId);
        return { url: `https://t.me/ProjectsFlow_Bot?start=connect_${userId}` };
      },
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

  return {
    service, rows, sent, answers, invites, deleted, added, started, pairings, members,
    advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
    rebind: (workspaceId: string | null) => { bound = workspaceId; },
  };
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

const onlyRow = (h: ReturnType<typeof harness>) => [...h.rows.values()][0]!;

test('prompt: unlinked sender gets 3 steps and a deep-link button; the text waits', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  const msg = h.sent[0]!;
  assert.equal(msg.chatId, -1001);
  assert.equal(msg.replyToMessageId, 1);
  assert.match(msg.text, /1️⃣/);
  assert.match(msg.text, /3️⃣/);
  assert.match(msg.text, /Программисты/);
  const row = onlyRow(h);
  assert.equal(msg.replyMarkup.inline_keyboard[0][0].url, `https://t.me/ProjectsFlow_Bot?start=wj_${row.id}`);
  assert.match(row.id, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(row.pendingText, 'Сделать отчёт');
});

test('prompt: a second message within 10 minutes is appended with a short reply; redelivery is ignored', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  await h.service.prompt(prompt());
  h.advance(60_000);
  await h.service.prompt(prompt({ text: 'И презентацию', sourceKey: 'm:-1001:2', replyToMessageId: 2 }));
  assert.equal(h.rows.size, 1);
  assert.equal(onlyRow(h).pendingText, 'Сделать отчёт\n\nИ презентацию');
  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1]!.text, /Запомнил/);
});

test('prompt: linked non-member gets a join callback button', async () => {
  const h = harness();
  await h.service.prompt(prompt({ linkedUserId: 'u-ivan' }));
  const button = h.sent[0]!.replyMarkup.inline_keyboard[0][0];
  assert.equal(button.callback_data, `wj:${onlyRow(h).id}`);
  assert.match(button.text, /Вступить/);
});

test('prompt: group moved to another workspace — the old invite is revoked', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  await h.service.handlePrivateStart({ id: onlyRow(h).id, chatId: 777, from: { id: 777 } });
  const oldInvite = h.invites[0]!.id;
  h.rebind('ws2');
  await h.service.prompt(prompt({ workspaceId: 'ws2', workspaceName: 'Офис', sourceKey: 'm:-1001:3' }));
  const row = onlyRow(h);
  assert.equal(row.workspaceId, 'ws2');
  assert.equal(row.inviteId, null);
  assert.equal(row.status, 'pending');
  assert.deepEqual(h.deleted, [oldInvite]);
});

test('handlePrivateStart: another Telegram user cannot use the button', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  await h.service.handlePrivateStart({ id: onlyRow(h).id, chatId: 888, from: { id: 888 } });
  assert.equal(h.invites.length, 0);
  assert.match(h.sent.at(-1)!.text, /для другого участника/);
});

test('handlePrivateStart: unlinked author gets one personal editor invite, Telegram is not linked by it', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  const row = onlyRow(h);
  await h.service.handlePrivateStart({ id: row.id, chatId: 777, from: { id: 777, username: 'ivan', first_name: 'Иван' } });
  assert.equal(h.invites.length, 1);
  const invite = h.invites[0]!;
  assert.equal(invite.role, 'editor');
  assert.equal(invite.email, null);
  assert.equal(invite.expiresAt.getTime() - NOW.getTime(), 7 * 24 * 3600 * 1000);
  const dm = h.sent.at(-1)!;
  assert.equal(dm.chatId, 777);
  assert.equal(dm.replyMarkup.inline_keyboard[0][0].url, `https://pf.test/invite/${invite.token}`);
  assert.match(dm.text, /Подключить Telegram/);
  assert.equal(h.rows.get(row.id)!.status, 'invited');
  await h.service.handlePrivateStart({ id: row.id, chatId: 777, from: { id: 777 } });
  assert.equal(h.invites.length, 1, 'repeated Start reuses the invite');
});

test('handlePrivateStart: linked author joins as editor and the task is created', async () => {
  const h = harness({ linkedUsers: { 777: 'u-ivan' } });
  await h.service.prompt(prompt({ linkedUserId: 'u-ivan' }));
  const row = onlyRow(h);
  await h.service.handlePrivateStart({ id: row.id, chatId: 777, from: { id: 777 } });
  assert.deepEqual(h.added, [{ workspaceId: 'ws1', userId: 'u-ivan', role: 'editor' }]);
  assert.deepEqual(h.started, [{ tgUserId: 777, chatId: -1001, text: 'Сделать отчёт', sourceKey: `ob:${row.id}` }]);
});

test('disconnected group: buttons no longer let anyone in', async () => {
  const h = harness({ linkedUsers: { 777: 'u-ivan' } });
  await h.service.prompt(prompt({ linkedUserId: 'u-ivan' }));
  const row = onlyRow(h);
  h.rebind(null);
  await h.service.handleJoinCallback({ id: 'cq', from: { id: 777 } }, row.id);
  assert.equal(h.added.length, 0);
  assert.match(h.answers[0]!.text ?? '', /больше не подключена/);
  await h.service.handlePrivateStart({ id: row.id, chatId: 777, from: { id: 777 } });
  assert.equal(h.added.length, 0);
  assert.equal(h.rows.get(row.id)!.status, 'cancelled');
});

test('a member removed by the lead cannot rejoin through the group', async () => {
  const h = harness({ linkedUsers: { 777: 'u-ivan' }, removed: ['u-ivan'] });
  await h.service.prompt(prompt({ linkedUserId: 'u-ivan' }));
  await h.service.handleJoinCallback({ id: 'cq', from: { id: 777 } }, onlyRow(h).id);
  assert.equal(h.added.length, 0);
  assert.equal(h.answers[0]!.showAlert, true);
  assert.match(h.answers[0]!.text ?? '', /удалили/);
});

test('handleJoinCallback: only the author can join; then the task is created once', async () => {
  const h = harness({ linkedUsers: { 777: 'u-ivan', 888: 'u-petr' } });
  await h.service.prompt(prompt({ linkedUserId: 'u-ivan' }));
  const id = onlyRow(h).id;
  await h.service.handleJoinCallback({ id: 'cq1', from: { id: 888 } }, id);
  assert.equal(h.answers[0]!.showAlert, true);
  assert.equal(h.added.length, 0);
  await h.service.handleJoinCallback({ id: 'cq2', from: { id: 777 } }, id);
  await h.service.handleJoinCallback({ id: 'cq3', from: { id: 777 } }, id);
  assert.deepEqual(h.added, [{ workspaceId: 'ws1', userId: 'u-ivan', role: 'editor' }]);
  assert.equal(h.started.length, 1);
});

test('guardInviteAcceptance: invite of a disconnected group or for a removed member is refused', async () => {
  const h = harness({ removed: ['u-removed'] });
  await h.service.prompt(prompt());
  await h.service.handlePrivateStart({ id: onlyRow(h).id, chatId: 777, from: { id: 777 } });
  const inviteId = h.invites[0]!.id;
  await h.service.guardInviteAcceptance({ inviteId, userId: 'u-new' });
  await assert.rejects(h.service.guardInviteAcceptance({ inviteId, userId: 'u-removed' }), WorkspaceRejoinBlockedError);
  h.rebind(null);
  await assert.rejects(h.service.guardInviteAcceptance({ inviteId, userId: 'u-new' }), WorkspaceInviteExpiredError);
  // Обычное приглашение не из группы — без проверок.
  await h.service.guardInviteAcceptance({ inviteId: 'ordinary', userId: 'u-removed' });
});

test('completeFromInvite: never links Telegram — returns a pairing link for the account owner', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  await h.service.handlePrivateStart({ id: onlyRow(h).id, chatId: 777, from: { id: 777 } });
  h.members.add('u-new');
  const result = await h.service.completeFromInvite({ inviteId: h.invites[0]!.id, userId: 'u-new' });
  assert.deepEqual(result, { telegram: { status: 'pair', url: 'https://t.me/ProjectsFlow_Bot?start=connect_u-new' } });
  assert.deepEqual(h.pairings, ['u-new']);
  assert.equal(h.started.length, 0, 'no task until the owner links Telegram');
});

test('completeAfterPairing: the task is created only for the Telegram that wrote in the group', async () => {
  // Злоумышленник прислал ссылку другому человеку: тот привязал СВОЙ Telegram (999) —
  // задача автора (777) не создаётся и Telegram автора к чужому аккаунту не попадает.
  const h = harness({ linkedUsers: { 999: 'u-victim', 777: 'u-ivan' }, members: ['u-victim', 'u-ivan'] });
  await h.service.prompt(prompt());
  const row = onlyRow(h);
  await h.service.completeAfterPairing(999);
  assert.equal(h.started.length, 0);
  assert.equal(h.rows.get(row.id)!.status, 'pending');
  await h.service.completeAfterPairing(777);
  assert.deepEqual(h.started, [{ tgUserId: 777, chatId: -1001, text: 'Сделать отчёт', sourceKey: `ob:${row.id}` }]);
  assert.ok(h.sent.some((m) => m.chatId === 777 && /Готово/.test(m.text)));
  await h.service.completeAfterPairing(777);
  assert.equal(h.started.length, 1, 'only once');
});

test('completeAfterPairing: no task before the person joined the workspace', async () => {
  const h = harness({ linkedUsers: { 777: 'u-ivan' } });
  await h.service.prompt(prompt());
  await h.service.completeAfterPairing(777);
  assert.equal(h.started.length, 0);
});

test('completeFromInvite: account already has this Telegram → task; another Telegram → conflict', async () => {
  const same = harness({ accountTelegram: { 'u-ivan': 777 }, members: ['u-ivan'] });
  await same.service.prompt(prompt());
  await same.service.handlePrivateStart({ id: onlyRow(same).id, chatId: 777, from: { id: 777 } });
  assert.deepEqual(await same.service.completeFromInvite({ inviteId: same.invites[0]!.id, userId: 'u-ivan' }), {
    telegram: { status: 'linked' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(same.started.length, 1);
  const other = harness({ accountTelegram: { 'u-other': 123 }, members: ['u-other'] });
  await other.service.prompt(prompt());
  await other.service.handlePrivateStart({ id: onlyRow(other).id, chatId: 777, from: { id: 777 } });
  assert.deepEqual(await other.service.completeFromInvite({ inviteId: other.invites[0]!.id, userId: 'u-other' }), {
    telegram: { status: 'conflict' },
  });
  assert.equal(other.started.length, 0);
});

test('cancelForGroup: open onboardings are closed and their invites revoked', async () => {
  const h = harness();
  await h.service.prompt(prompt());
  await h.service.handlePrivateStart({ id: onlyRow(h).id, chatId: 777, from: { id: 777 } });
  await h.service.cancelForGroup('ws1', -1001);
  assert.equal(onlyRow(h).status, 'cancelled');
  assert.deepEqual(h.deleted, [h.invites[0]!.id]);
});
