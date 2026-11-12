import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ManageTelegramWorkGroups } from './ManageTelegramWorkGroups.js';
import type {
  TelegramGroupLinkCode,
  TelegramWorkGroup,
  TelegramWorkGroupRepository,
} from './TelegramWorkGroupRepository.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import { NotWorkspaceLeadError, CannotInviteToDefaultWorkspaceError } from '../../domain/workspace/errors.js';
import {
  TelegramGroupNotAdminError,
  TelegramGroupNotFoundError,
  TelegramGroupTakenError,
  TelegramNotLinkedError,
} from '../../domain/telegram/errors.js';

const NOW = new Date('2026-11-12T10:00:00Z');
const TOKEN = 'A'.repeat(43);
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

function makeRepo() {
  const groups = new Map<number, TelegramWorkGroup>();
  const codes = new Map<string, TelegramGroupLinkCode & { expiresAt: Date }>();
  const main: Array<{ workspaceId: string; chatId: number; title: string | null }> = [];
  const repo: TelegramWorkGroupRepository = {
    async listByWorkspace(workspaceId) {
      return [...groups.values()].filter((g) => g.workspaceId === workspaceId);
    },
    async findByChat(chatId) {
      return groups.get(chatId) ?? null;
    },
    async insert(group) {
      if (groups.has(group.chatId)) return 'exists';
      groups.set(group.chatId, { ...group, createdAt: NOW });
      return 'created';
    },
    async updateTitle(chatId, title) {
      const g = groups.get(chatId);
      if (g) groups.set(chatId, { ...g, title });
    },
    async remove(workspaceId, chatId) {
      const g = groups.get(chatId);
      if (!g || g.workspaceId !== workspaceId) return false;
      groups.delete(chatId);
      return true;
    },
    async migrateChat() {},
    async getMainGroup(workspaceId) {
      const last = main.filter((m) => m.workspaceId === workspaceId).at(-1);
      return last ? { chatId: last.chatId, title: last.title } : null;
    },
    async setMainGroup(workspaceId, chatId, title) {
      main.push({ workspaceId, chatId, title });
    },
    async issueLinkCode(input) {
      codes.set(input.tokenHash, input);
    },
    async consumeLinkCode(tokenHash, now) {
      const code = codes.get(tokenHash);
      codes.delete(tokenHash);
      if (!code || code.expiresAt <= now) return null;
      return { workspaceId: code.workspaceId, purpose: code.purpose, createdByUserId: code.createdByUserId };
    },
  };
  return { repo, groups, codes, main };
}

function makeService(opts: {
  roles?: Record<string, WorkspaceRole>;
  kind?: 'team' | 'default';
  telegramUserId?: number | null;
  // Статус отправителя/добавляющего (Telegram id 555) среди администраторов группы.
  adminStatus?: string | null;
  chatExists?: boolean;
} = {}) {
  const store = makeRepo();
  const roles = opts.roles ?? { owner: 'owner', lead: 'lead', viewer: 'viewer' };
  const service = new ManageTelegramWorkGroups({
    repo: store.repo,
    workspaces: {
      async getMembership(workspaceId, userId) {
        const role = workspaceId === 'ws1' ? roles[userId] : undefined;
        return role ? { workspaceId, userId, role, displayName: null, email: null, avatarUrl: null } : null;
      },
      async getById(id) {
        if (id === 'ws1') return { id, name: 'Программисты', kind: opts.kind ?? 'team' };
        if (id === 'ws2') return { id, name: 'Офис', kind: 'team' };
        return null;
      },
    },
    users: {
      async getTelegramLink() {
        return opts.telegramUserId === null ? null : { telegramUserId: opts.telegramUserId ?? 555 };
      },
    },
    telegram: {
      async getChat(chatId) {
        return opts.chatExists === false ? null : { id: chatId, title: 'Команда', type: 'supergroup' };
      },
      async getChatAdministrators() {
        if (opts.adminStatus === null) return null;
        return [{ userId: 555, status: opts.adminStatus ?? 'administrator' }, { userId: 999, status: 'creator' }];
      },
    },
    botUsername: 'ProjectsFlow_Bot',
    randomToken: () => TOKEN,
    now: () => NOW,
  });
  return { service, ...store };
}

test('createLink: lead gets a startgroup deep link; only the hash is stored for 30 minutes', async () => {
  const { service, codes } = makeService();
  const link = await service.createLink('ws1', 'lead', 'work');
  assert.equal(link.url, `https://t.me/ProjectsFlow_Bot?startgroup=wg_${TOKEN}`);
  const stored = codes.get(sha(TOKEN));
  assert.ok(stored, 'hash of the code is stored');
  assert.equal(stored.purpose, 'work');
  assert.equal(stored.expiresAt.getTime() - NOW.getTime(), 30 * 60 * 1000);
  assert.equal(codes.has(TOKEN), false, 'raw code is never stored');
});

test('createLink: viewer cannot connect work groups, default hub cannot have them', async () => {
  await assert.rejects(makeService().service.createLink('ws1', 'viewer', 'work'), NotWorkspaceLeadError);
  await assert.rejects(
    makeService({ kind: 'default' }).service.createLink('ws1', 'owner', 'work'),
    CannotInviteToDefaultWorkspaceError,
  );
  // Основную группу сводок, как и всю карточку сводок, может менять любой участник.
  const main = await makeService().service.createLink('ws1', 'viewer', 'main');
  assert.match(main.url, /startgroup=wg_/);
});

test('bindFromCode: binds the group once, the code is single-use', async () => {
  const { service, groups } = makeService();
  await service.createLink('ws1', 'lead', 'work');
  const first = await service.bindFromCode(TOKEN, { id: -1001, title: 'Команда' }, 555);
  assert.deepEqual(first, { kind: 'bound', workspaceName: 'Программисты' });
  assert.equal(groups.get(-1001)?.workspaceId, 'ws1');
  assert.equal(groups.get(-1001)?.addedByUserId, 'lead');
  assert.deepEqual(await service.bindFromCode(TOKEN, { id: -1001, title: 'Команда' }, 555), { kind: 'invalid' });
});

test('bindFromCode: same workspace → already; other workspace → taken without its name', async () => {
  const { service, groups } = makeService();
  groups.set(-1001, { chatId: -1001, workspaceId: 'ws1', title: 'Старое', addedByUserId: null, createdAt: NOW });
  groups.set(-1002, { chatId: -1002, workspaceId: 'ws2', title: 'Офис', addedByUserId: null, createdAt: NOW });
  await service.createLink('ws1', 'lead', 'work');
  assert.deepEqual(await service.bindFromCode(TOKEN, { id: -1001, title: 'Новое' }, 555), {
    kind: 'already',
    workspaceName: 'Программисты',
  });
  assert.equal(groups.get(-1001)?.title, 'Новое');
  await service.createLink('ws1', 'lead', 'work');
  assert.deepEqual(await service.bindFromCode(TOKEN, { id: -1002, title: 'Офис' }, 555), { kind: 'taken' });
});

test('bindFromCode: purpose main sets the digest group instead of a work group', async () => {
  const { service, groups, main } = makeService();
  await service.createLink('ws1', 'viewer', 'main');
  assert.deepEqual(await service.bindFromCode(TOKEN, { id: -1003, title: 'Сводки' }, 555), {
    kind: 'main',
    workspaceName: 'Программисты',
  });
  assert.deepEqual(main, [{ workspaceId: 'ws1', chatId: -1003, title: 'Сводки' }]);
  assert.equal(groups.size, 0);
  const listed = await service.list('ws1', 'viewer');
  assert.deepEqual(listed.mainGroup, { chatId: -1003, title: 'Сводки' });
});

test('bindFromCode: only a group admin can bind; the code survives a refused attempt', async () => {
  const { service, groups } = makeService({ adminStatus: 'member' });
  await service.createLink('ws1', 'lead', 'work');
  assert.deepEqual(await service.bindFromCode(TOKEN, { id: -1001, title: 'Команда' }, 555), { kind: 'not_admin' });
  assert.equal(groups.size, 0);
  // Создатель группы (id 999) подключает тем же кодом.
  assert.deepEqual(await service.bindFromCode(TOKEN, { id: -1001, title: 'Команда' }, 999), {
    kind: 'bound',
    workspaceName: 'Программисты',
  });
});

test('remove: disconnecting a group closes waiting onboardings', async () => {
  const removed: Array<[string, number]> = [];
  const { service, groups } = makeService();
  groups.set(-1001, { chatId: -1001, workspaceId: 'ws1', title: 'Команда', addedByUserId: null, createdAt: NOW });
  const withHook = new ManageTelegramWorkGroups({
    ...(service as unknown as { deps: ConstructorParameters<typeof ManageTelegramWorkGroups>[0] }).deps,
    onRemoved: async (workspaceId, chatId) => {
      removed.push([workspaceId, chatId]);
    },
  });
  await withHook.remove('ws1', 'lead', -1001);
  assert.deepEqual(removed, [['ws1', -1001]]);
  await withHook.remove('ws1', 'lead', -1001);
  assert.equal(removed.length, 1, 'nothing removed → no hook');
});

test('addManual: requires a group the bot sees and the actor is its admin', async () => {
  await assert.rejects(makeService({ chatExists: false }).service.addManual('ws1', 'lead', -1001), TelegramGroupNotFoundError);
  await assert.rejects(makeService({ telegramUserId: null }).service.addManual('ws1', 'lead', -1001), TelegramNotLinkedError);
  await assert.rejects(makeService({ adminStatus: 'member' }).service.addManual('ws1', 'lead', -1001), TelegramGroupNotAdminError);
  await assert.rejects(makeService({ adminStatus: null }).service.addManual('ws1', 'lead', -1001), TelegramGroupNotAdminError);
  await assert.rejects(makeService().service.addManual('ws1', 'viewer', -1001), NotWorkspaceLeadError);
  await assert.rejects(makeService().service.addManual('ws1', 'lead', 42), TelegramGroupNotFoundError);
  const { service, groups } = makeService();
  const group = await service.addManual('ws1', 'lead', -1001);
  assert.equal(group.title, 'Команда');
  assert.equal(groups.get(-1001)?.workspaceId, 'ws1');
});

test('addManual: a group of another workspace is rejected', async () => {
  const { service, groups } = makeService();
  groups.set(-1002, { chatId: -1002, workspaceId: 'ws2', title: 'Офис', addedByUserId: null, createdAt: NOW });
  await assert.rejects(service.addManual('ws1', 'lead', -1002), TelegramGroupTakenError);
});

test('resolveChat: work group of a team workspace → its id and name', async () => {
  const { service, groups } = makeService();
  groups.set(-1001, { chatId: -1001, workspaceId: 'ws1', title: 'Команда', addedByUserId: 'lead', createdAt: NOW });
  assert.deepEqual(await service.resolveChat(-1001), { workspaceId: 'ws1', workspaceName: 'Программисты', addedByUserId: 'lead' });
  assert.equal(await service.resolveChat(-9999), null);
});
