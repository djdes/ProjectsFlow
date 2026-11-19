import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import type { CreateNotificationInput } from '../notifications/NotificationRepository.js';
import { SyncTelegramGroupMembers } from './SyncTelegramGroupMembers.js';
import type {
  LinkedTelegramGroupMember,
  TelegramGroupMemberRepository,
  TelegramGroupMemberSighting,
  TelegramGroupMemberSource,
  TelegramGroupMemberStatus,
} from './TelegramGroupMemberRepository.js';
import type { TelegramWorkGroup, TelegramWorkGroupMode, TelegramWorkGroupStatus } from './TelegramWorkGroupRepository.js';

// Участники рабочих групп (db/191, spec 2026-11-17 §4): записи из всех источников и правила
// молчаливого добавления в пространство.
const CHAT = -1001;
const WS = 'ws1';

class MemoryMembers implements TelegramGroupMemberRepository {
  rows = new Map<string, { chatId: number; tgUserId: number; status: TelegramGroupMemberStatus; source: TelegramGroupMemberSource }>();
  constructor(private readonly linkedUsers: Map<number, string>) {}
  async upsert(s: TelegramGroupMemberSighting): Promise<void> {
    const key = `${s.chatId}:${s.tgUserId}`;
    const prev = this.rows.get(key);
    const status = s.status ?? (prev && prev.status !== 'left' ? prev.status : 'member');
    this.rows.set(key, { chatId: s.chatId, tgUserId: s.tgUserId, status, source: s.source });
  }
  async summary(chatId: number) {
    const present = [...this.rows.values()].filter((r) => r.chatId === chatId && r.status !== 'left');
    const linked: LinkedTelegramGroupMember[] = present.flatMap((r) => {
      const userId = this.linkedUsers.get(r.tgUserId);
      return userId
        ? [{ tgUserId: r.tgUserId, userId, displayName: userId, avatarUrl: null, status: r.status === 'admin' ? 'admin' as const : 'member' as const }]
        : [];
    });
    return { telegramCount: present.length, linked };
  }
  get(tgUserId: number) {
    return this.rows.get(`${CHAT}:${tgUserId}`);
  }
}

function harness(opts: {
  status?: TelegramWorkGroupStatus;
  mode?: TelegramWorkGroupMode;
  members?: Array<[string, WorkspaceRole]>;
  removed?: string[];
  linked?: Array<[number, string]>;
  admins?: Array<{ userId: number; status: string; isBot?: boolean; username?: string }> | null;
} = {}) {
  const linkedUsers = new Map(opts.linked ?? []);
  const repo = new MemoryMembers(linkedUsers);
  const members = new Map<string, WorkspaceRole>(opts.members ?? [['owner1', 'owner'], ['lead1', 'lead'], ['viewer1', 'viewer']]);
  const removed = new Set(opts.removed ?? []);
  const notifications: CreateNotificationInput[] = [];
  const added: Array<{ userId: string; role: WorkspaceRole }> = [];
  let adminCalls = 0;
  let clock = new Date('2026-11-18T10:00:00Z').getTime();
  let n = 0;
  const group: TelegramWorkGroup = {
    chatId: CHAT,
    workspaceId: WS,
    title: 'Команда',
    addedByUserId: 'lead1',
    createdAt: new Date(),
    status: opts.status ?? 'active',
    mode: opts.mode ?? 'standard',
    invitedByTgUserId: null,
    projectIds: [],
  };
  const member = (userId: string): WorkspaceMember | null => {
    const role = members.get(userId);
    return role ? { workspaceId: WS, userId, role, displayName: `Имя ${userId}` } : null;
  };
  const sync = new SyncTelegramGroupMembers({
    repo,
    groups: { async findByChat(chatId) { return chatId === CHAT ? group : null; } },
    workspaces: {
      async getById(id) { return id === WS ? { id, name: 'Программисты', kind: 'team' as const } : null; },
      async getMembership(_ws, userId) { return member(userId); },
      async listMembers() { return [...members.keys()].map((id) => member(id)!); },
      async addMember(_ws, userId, role) {
        added.push({ userId, role });
        if (!members.has(userId)) members.set(userId, role);
        removed.delete(userId);
      },
      async wasRemoved(_ws, userId) { return removed.has(userId); },
    },
    users: { async findUserIdByTelegramUserId(id) { return linkedUsers.get(id) ?? null; } },
    notifications: { async create(input) { notifications.push(input); return input as never; } },
    telegram: {
      async getChatAdministrators() {
        adminCalls += 1;
        return opts.admins === undefined ? [] : opts.admins;
      },
    },
    botUsername: '@ProjectsFlow_Bot',
    idGen: () => `n${++n}`,
    now: () => new Date(clock),
  });
  return {
    sync, repo, members, added, notifications,
    adminCalls: () => adminCalls,
    tick: (ms: number) => { clock += ms; },
  };
}

test('автор сообщения: запись source=message, связанный с PF добавлен редактором, руководителям уведомление', async () => {
  const x = harness({ linked: [[501, 'newbie']] });
  await x.sync.recordMessageAuthor(CHAT, 501);
  assert.deepEqual(x.repo.get(501), { chatId: CHAT, tgUserId: 501, status: 'member', source: 'message' });
  assert.deepEqual(x.added, [{ userId: 'newbie', role: 'editor' }]);
  assert.deepEqual(x.notifications.map((n) => n.userId).sort(), ['lead1', 'owner1']);
  const payload = x.notifications[0]!.payload;
  assert.equal(payload.type, 'telegram_group_member_added');
  assert.equal(payload.type === 'telegram_group_member_added' && payload.memberDisplayName, 'Имя newbie');
  assert.equal(payload.type === 'telegram_group_member_added' && payload.groupTitle, 'Команда');
});

test('автор без аккаунта PF — только запись (incident-режим), в пространство никого', async () => {
  const x = harness({ mode: 'incident' });
  await x.sync.recordMessageAuthor(CHAT, 900);
  assert.equal(x.repo.get(900)?.source, 'message');
  assert.deepEqual(x.added, []);
  assert.deepEqual(x.notifications, []);
});

test('incident-режим: связанный с PF автор тоже добавляется', async () => {
  const x = harness({ mode: 'incident', linked: [[501, 'newbie']] });
  await x.sync.recordMessageAuthor(CHAT, 501);
  assert.deepEqual(x.added, [{ userId: 'newbie', role: 'editor' }]);
});

test('уже в пространстве — роль не меняется (viewer остаётся viewer), уведомлений нет', async () => {
  const x = harness({ linked: [[502, 'viewer1']] });
  await x.sync.recordMessageAuthor(CHAT, 502);
  await x.sync.handleMemberUpdate(CHAT, 502, 'administrator');
  assert.deepEqual(x.added, []);
  assert.equal(x.members.get('viewer1'), 'viewer');
  assert.deepEqual(x.notifications, []);
  assert.equal(x.repo.get(502)?.status, 'admin');
});

test('удалённый руководителем (workspace_member_removals) не возвращается ни одним источником', async () => {
  const x = harness({ linked: [[503, 'kicked1']], removed: ['kicked1'], admins: [{ userId: 503, status: 'administrator' }] });
  await x.sync.recordMessageAuthor(CHAT, 503);
  await x.sync.handleMemberUpdate(CHAT, 503, 'member');
  await x.sync.snapshotAdmins(CHAT);
  assert.deepEqual(x.added, []);
  assert.deepEqual(x.notifications, []);
  assert.equal(x.repo.get(503)?.status, 'admin', 'the Telegram membership is still recorded');
});

test('chat_member: вступление source=join, выход — left, из пространства не удаляем', async () => {
  const x = harness({ linked: [[504, 'joiner']] });
  await x.sync.handleMemberUpdate(CHAT, 504, 'member');
  assert.deepEqual(x.repo.get(504), { chatId: CHAT, tgUserId: 504, status: 'member', source: 'join' });
  assert.deepEqual(x.added, [{ userId: 'joiner', role: 'editor' }]);
  await x.sync.handleMemberUpdate(CHAT, 504, 'left');
  assert.equal(x.repo.get(504)?.status, 'left');
  assert.equal(x.members.get('joiner'), 'editor', 'leaving the group keeps the workspace membership');
  await x.sync.handleMemberUpdate(CHAT, 505, 'kicked');
  assert.equal(x.repo.get(505)?.status, 'left');
  await x.sync.handleMemberUpdate(CHAT, 506, 'restricted', { isMember: false });
  assert.equal(x.repo.get(506)?.status, 'left');
  await x.sync.handleMemberUpdate(CHAT, 507, 'restricted', { isMember: true });
  assert.equal(x.repo.get(507)?.status, 'member');
});

test('вышедший снова пишет — снова member; администратор от сообщения не понижается', async () => {
  const x = harness();
  await x.sync.handleMemberUpdate(CHAT, 510, 'left');
  await x.sync.recordMessageAuthor(CHAT, 510);
  assert.equal(x.repo.get(510)?.status, 'member');
  await x.sync.handleMemberUpdate(CHAT, 511, 'creator');
  await x.sync.recordMessageAuthor(CHAT, 511);
  assert.equal(x.repo.get(511)?.status, 'admin');
});

test('снимок администраторов: source=admins, боты пропускаются, бот-админ определяется', async () => {
  const x = harness({
    linked: [[520, 'adminUser']],
    admins: [
      { userId: 520, status: 'creator' },
      { userId: 521, status: 'administrator' },
      { userId: 999, status: 'administrator', isBot: true, username: 'ProjectsFlow_Bot' },
    ],
  });
  assert.equal(await x.sync.snapshotAdmins(CHAT), true);
  assert.deepEqual(x.repo.get(520), { chatId: CHAT, tgUserId: 520, status: 'admin', source: 'admins' });
  assert.equal(x.repo.get(521)?.source, 'admins');
  assert.equal(x.repo.get(999), undefined);
  assert.deepEqual(x.added, [{ userId: 'adminUser', role: 'editor' }]);
});

test('черновик и отключённая группа ничего не открывают и не записывают', async () => {
  for (const status of ['draft', 'disconnected'] as const) {
    const x = harness({ status, linked: [[530, 'someone']], admins: [{ userId: 530, status: 'creator' }] });
    await x.sync.recordMessageAuthor(CHAT, 530);
    await x.sync.handleMemberUpdate(CHAT, 530, 'member');
    assert.equal(await x.sync.snapshotAdmins(CHAT), null);
    assert.equal(x.repo.rows.size, 0);
    assert.deepEqual(x.added, []);
  }
});

test('повторные сообщения автора в окне троттлинга БД не трогают', async () => {
  const x = harness({ linked: [[540, 'chatty']] });
  await x.sync.recordMessageAuthor(CHAT, 540);
  x.repo.rows.clear();
  await x.sync.recordMessageAuthor(CHAT, 540);
  assert.equal(x.repo.rows.size, 0);
  x.tick(11 * 60 * 1000);
  await x.sync.recordMessageAuthor(CHAT, 540);
  assert.equal(x.repo.rows.size, 1);
  assert.equal(x.notifications.length, 2, 'only the first add notified the two leads');
});

test('summary: N в Telegram, M связаны с PF, бот не админ; запрос к Telegram кешируется', async () => {
  const x = harness({ linked: [[550, 'linkedUser']], admins: [{ userId: 551, status: 'creator' }] });
  await x.sync.recordMessageAuthor(CHAT, 550);
  await x.sync.handleMemberUpdate(CHAT, 552, 'left');
  const first = await x.sync.summary(WS, 'viewer1', CHAT);
  assert.equal(first.telegramCount, 2);
  assert.deepEqual(first.linked.map((m) => m.userId), ['linkedUser']);
  assert.equal(first.botIsAdmin, false);
  await x.sync.summary(WS, 'viewer1', CHAT);
  assert.equal(x.adminCalls(), 1);
  await assert.rejects(x.sync.summary(WS, 'stranger', CHAT));
  await assert.rejects(x.sync.summary('other', 'viewer1', CHAT));
});

test('бот стал администратором — снимок администраторов', async () => {
  const x = harness({ admins: [{ userId: 560, status: 'creator' }] });
  await x.sync.handleBotRightsChanged(CHAT, true);
  assert.equal(x.repo.get(560)?.source, 'admins');
  const summary = await x.sync.summary(WS, 'owner1', CHAT);
  assert.equal(summary.botIsAdmin, false, 'the snapshot found no bot among admins');
});
