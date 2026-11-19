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
import { NotWorkspaceLeadError, NotWorkspaceOwnerError, CannotInviteToDefaultWorkspaceError, WorkspaceNotFoundError } from '../../domain/workspace/errors.js';
import {
  TelegramGroupDraftElsewhereError,
  TelegramGroupTransferNotFoundError,
  TelegramGroupTransferRequestedError,
  TelegramGroupNotAdminError,
  TelegramGroupNotFoundError,
  TelegramGroupProjectInvalidError,
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
      groups.set(group.chatId, {
        ...group,
        createdAt: NOW,
        status: group.status ?? 'active',
        invitedByTgUserId: group.invitedByTgUserId ?? null,
        projectIds: [],
      });
      return 'created';
    },
    async replace(group) {
      const g = groups.get(group.chatId);
      if (!g) return;
      groups.set(group.chatId, {
        ...g,
        workspaceId: group.workspaceId,
        addedByUserId: group.addedByUserId,
        status: group.status ?? 'active',
        title: group.title ?? g.title,
        invitedByTgUserId: group.invitedByTgUserId ?? g.invitedByTgUserId,
        projectIds: g.workspaceId === group.workspaceId ? g.projectIds : [],
        mode: g.workspaceId === group.workspaceId ? g.mode : 'standard',
        transfer: null,
      });
    },
    async requestTransfer(chatId, transfer) {
      const g = groups.get(chatId);
      if (g) groups.set(chatId, { ...g, transfer: { ...transfer, requestedAt: NOW } });
    },
    async clearTransfer(chatId) {
      const g = groups.get(chatId);
      if (g) groups.set(chatId, { ...g, transfer: null });
    },
    async setStatus(chatId, status) {
      const g = groups.get(chatId);
      if (g) groups.set(chatId, { ...g, status });
    },
    async setMode(chatId, mode) {
      const g = groups.get(chatId);
      if (g) groups.set(chatId, { ...g, mode });
    },
    async setProjects(chatId, projectIds) {
      const g = groups.get(chatId);
      if (g) groups.set(chatId, { ...g, projectIds: [...projectIds] });
    },
    async listActiveProjectIds(chatId) {
      const g = groups.get(chatId);
      return g?.status === 'active' ? [...g.projectIds] : [];
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
  // Командные пространства, где пригласивший бота (Telegram 777 → user 'lead') руководит.
  leadSpaces?: Array<{ id: string; name: string; role: WorkspaceRole }>;
  // Роли в пространстве ws2 («Офис»): по умолчанию там никого.
  ws2Roles?: Record<string, WorkspaceRole>;
} = {}) {
  const store = makeRepo();
  const roles = opts.roles ?? { owner: 'owner', lead: 'lead', viewer: 'viewer' };
  const service = new ManageTelegramWorkGroups({
    repo: store.repo,
    workspaces: {
      async getMembership(workspaceId, userId) {
        const role =
          workspaceId === 'ws1' ? roles[userId] : workspaceId === 'ws2' ? opts.ws2Roles?.[userId] : undefined;
        return role ? { workspaceId, userId, role, displayName: null, email: null, avatarUrl: null } : null;
      },
      async getById(id) {
        if (id === 'ws1') return { id, name: 'Программисты', kind: opts.kind ?? 'team' };
        if (id === 'ws2') return { id, name: 'Офис', kind: 'team' };
        return null;
      },
      async listForUser(userId) {
        if (userId !== 'lead') return [];
        return (opts.leadSpaces ?? [{ id: 'ws1', name: 'Программисты', role: 'lead' as WorkspaceRole }]).map(
          (w) => ({ ...w, kind: 'team' as const }),
        );
      },
    },
    users: {
      async getTelegramLink() {
        return opts.telegramUserId === null ? null : { telegramUserId: opts.telegramUserId ?? 555 };
      },
      async findUserIdByTelegramUserId(tgUserId) {
        return tgUserId === 777 ? 'lead' : null;
      },
    },
    projects: {
      async getById(id) {
        if (id === 'p1' || id === 'p2') return { id, workspaceId: 'ws1', isInbox: false };
        if (id === 'inbox') return { id, workspaceId: 'ws1', isInbox: true };
        if (id === 'foreign') return { id, workspaceId: 'ws2', isInbox: false };
        return null;
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
  groups.set(-1001, { chatId: -1001, workspaceId: 'ws1', title: 'Старое', addedByUserId: null, createdAt: NOW, status: 'active', invitedByTgUserId: null, projectIds: [] });
  groups.set(-1002, { chatId: -1002, workspaceId: 'ws2', title: 'Офис', addedByUserId: null, createdAt: NOW, status: 'active', invitedByTgUserId: null, projectIds: [] });
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
  groups.set(-1001, { chatId: -1001, workspaceId: 'ws1', title: 'Команда', addedByUserId: null, createdAt: NOW, status: 'active', invitedByTgUserId: null, projectIds: [] });
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
  groups.set(-1002, { chatId: -1002, workspaceId: 'ws2', title: 'Офис', addedByUserId: null, createdAt: NOW, status: 'active', invitedByTgUserId: null, projectIds: [] });
  await assert.rejects(service.addManual('ws1', 'lead', -1002), TelegramGroupTakenError);
});

test('resolveChat: work group of a team workspace → its id and name', async () => {
  const { service, groups } = makeService();
  groups.set(-1001, { chatId: -1001, workspaceId: 'ws1', title: 'Команда', addedByUserId: 'lead', createdAt: NOW, status: 'active', invitedByTgUserId: null, projectIds: [] });
  assert.deepEqual(await service.resolveChat(-1001), { workspaceId: 'ws1', workspaceName: 'Программисты', addedByUserId: 'lead', mode: 'standard' });
  assert.equal(await service.resolveChat(-9999), null);
});

test('handleBotAdded: inviter leading one team workspace → draft that opens nothing', async () => {
  const { service, groups } = makeService();
  const result = await service.handleBotAdded({ id: -2001, title: 'Поддержка' }, 777);
  assert.deepEqual(result, { kind: 'draft', workspaceName: 'Программисты' });
  const draft = groups.get(-2001);
  assert.equal(draft?.status, 'draft');
  assert.equal(draft?.workspaceId, 'ws1');
  assert.equal(draft?.invitedByTgUserId, 777);
  // Черновик не рабочая группа: бот ведёт себя как в обычной группе.
  assert.equal(await service.resolveChat(-2001), null);
  assert.deepEqual(await service.allowedProjectIds(-2001), []);
});

test('handleBotAdded: unlinked inviter, no lead role or several spaces → no silent draft', async () => {
  const { service, groups } = makeService();
  assert.deepEqual(await service.handleBotAdded({ id: -2002, title: null }, 1), { kind: 'not_linked' });
  const none = makeService({ leadSpaces: [] });
  assert.deepEqual(await none.service.handleBotAdded({ id: -2002, title: null }, 777), { kind: 'no_workspace' });
  const many = makeService({
    leadSpaces: [
      { id: 'ws1', name: 'Программисты', role: 'owner' },
      { id: 'ws2', name: 'Офис', role: 'lead' },
    ],
  });
  const choose = await many.service.handleBotAdded({ id: -2002, title: null }, 777);
  assert.equal(choose.kind, 'choose');
  assert.equal(groups.size + none.groups.size + many.groups.size, 0);
});

test('chooseDraftWorkspace: only an owner/lead of that workspace creates the draft', async () => {
  const { service, groups } = makeService();
  assert.deepEqual(await service.chooseDraftWorkspace({ id: -2003, title: 'Г' }, 'ws1', 1), { kind: 'forbidden' });
  assert.deepEqual(await service.chooseDraftWorkspace({ id: -2003, title: 'Г' }, 'ws2', 777), { kind: 'forbidden' });
  assert.deepEqual(await service.chooseDraftWorkspace({ id: -2003, title: 'Г' }, 'ws1', 777), {
    kind: 'draft',
    workspaceName: 'Программисты',
  });
  assert.equal(groups.get(-2003)?.status, 'draft');
});

test('handleBotAdded: an active work group stays active', async () => {
  const { service, groups } = makeService();
  await service.addManual('ws1', 'lead', -1001);
  assert.deepEqual(await service.handleBotAdded({ id: -1001, title: 'Новое имя' }, 777), { kind: 'active' });
  assert.equal(groups.get(-1001)?.status, 'active');
  assert.equal(groups.get(-1001)?.title, 'Новое имя');
});

test('confirm: owner/lead turn a draft into a work group; others cannot', async () => {
  const { service } = makeService();
  await service.handleBotAdded({ id: -2004, title: 'Поддержка' }, 777);
  await assert.rejects(service.confirm('ws1', 'viewer', -2004), NotWorkspaceLeadError);
  await assert.rejects(service.confirm('ws2', 'lead', -2004), WorkspaceNotFoundError);
  const group = await service.confirm('ws1', 'owner', -2004);
  assert.equal(group.status, 'active');
  assert.deepEqual(await service.resolveChat(-2004), {
    workspaceId: 'ws1',
    workspaceName: 'Программисты',
    addedByUserId: 'lead',
    mode: 'standard',
  });
});

test('confirm: unknown group of the workspace → not found', async () => {
  const { service } = makeService();
  await assert.rejects(service.confirm('ws1', 'lead', -9999), TelegramGroupNotFoundError);
});

test('setProjects: only lead, only projects of the group workspace, empty = all', async () => {
  const { service } = makeService();
  await service.addManual('ws1', 'lead', -1001);
  await assert.rejects(service.setProjects('ws1', 'viewer', -1001, ['p1']), NotWorkspaceLeadError);
  await assert.rejects(service.setProjects('ws1', 'lead', -1001, ['foreign']), TelegramGroupProjectInvalidError);
  await assert.rejects(service.setProjects('ws1', 'lead', -1001, ['inbox']), TelegramGroupProjectInvalidError);
  await assert.rejects(service.setProjects('ws1', 'lead', -1001, ['missing']), TelegramGroupProjectInvalidError);
  const group = await service.setProjects('ws1', 'lead', -1001, ['p1', 'p2', 'p1']);
  assert.deepEqual(group.projectIds, ['p1', 'p2']);
  assert.deepEqual(await service.allowedProjectIds(-1001), ['p1', 'p2']);
  const cleared = await service.setProjects('ws1', 'owner', -1001, []);
  assert.deepEqual(cleared.projectIds, []);
});

test('handleBotRemoved: active group is disconnected and onboardings are closed', async () => {
  const removed: Array<[string, number]> = [];
  const { service, groups } = makeService();
  (service as unknown as { deps: { onRemoved: (w: string, c: number) => Promise<void> } }).deps.onRemoved =
    async (w, c) => {
      removed.push([w, c]);
    };
  await service.addManual('ws1', 'lead', -1001);
  await service.handleBotRemoved(-1001);
  assert.equal(groups.get(-1001)?.status, 'disconnected');
  assert.deepEqual(removed, [['ws1', -1001]]);
  assert.equal(await service.resolveChat(-1001), null);
  await service.handleBotRemoved(-1001);
  assert.equal(removed.length, 1, 'repeated removal is a no-op');
});

test('bindFromCode: a draft group becomes active in the workspace of the code', async () => {
  const { service, groups } = makeService({ adminStatus: 'creator' });
  await service.handleBotAdded({ id: -2005, title: 'Поддержка' }, 777);
  await service.createLink('ws1', 'lead', 'work');
  const result = await service.bindFromCode(TOKEN, { id: -2005, title: 'Поддержка' }, 555);
  assert.deepEqual(result, { kind: 'bound', workspaceName: 'Программисты' });
  assert.equal(groups.get(-2005)?.status, 'active');
});

// --- Защита от перехвата чужих групп (draft / disconnected / active в другом пространстве) ---

const foreign = (status: TelegramWorkGroup['status']): TelegramWorkGroup => ({
  chatId: -3001,
  workspaceId: 'ws2',
  title: 'Офис',
  addedByUserId: 'ws2owner',
  createdAt: NOW,
  status,
  invitedByTgUserId: null,
  projectIds: [],
});

test('takeover: a draft of another workspace cannot be activated by code, id or confirm', async () => {
  const { service, groups } = makeService();
  groups.set(-3001, foreign('draft'));
  await service.createLink('ws1', 'lead', 'work');
  assert.deepEqual(await service.bindFromCode(TOKEN, { id: -3001, title: 'Офис' }, 555), { kind: 'draft_elsewhere' });
  await assert.rejects(service.addManual('ws1', 'lead', -3001), TelegramGroupDraftElsewhereError);
  await assert.rejects(service.confirm('ws1', 'lead', -3001), TelegramGroupNotFoundError);
  // Бот-приглашение руководителем ws1 тоже не переписывает чужой черновик.
  assert.deepEqual(await service.handleBotAdded({ id: -3001, title: 'Офис' }, 777), { kind: 'draft_elsewhere' });
  assert.deepEqual(groups.get(-3001), foreign('draft'));
});

test('takeover: a draft is activated in its own workspace by code and by id', async () => {
  const byCode = makeService();
  byCode.groups.set(-3001, { ...foreign('draft'), workspaceId: 'ws1' });
  await byCode.service.createLink('ws1', 'lead', 'work');
  assert.equal((await byCode.service.bindFromCode(TOKEN, { id: -3001, title: 'Офис' }, 555)).kind, 'bound');
  assert.equal(byCode.groups.get(-3001)?.status, 'active');
  const byId = makeService();
  byId.groups.set(-3001, { ...foreign('draft'), workspaceId: 'ws1' });
  assert.equal((await byId.service.addManual('ws1', 'lead', -3001)).status, 'active');
});

test('takeover: a disconnected group of another workspace moves only after its owner approves', async () => {
  const { service, groups } = makeService({ ws2Roles: { ws2owner: 'owner', ws2lead: 'lead' } });
  groups.set(-3001, foreign('disconnected'));
  await service.createLink('ws1', 'lead', 'work');
  assert.deepEqual(await service.bindFromCode(TOKEN, { id: -3001, title: 'Офис' }, 555), {
    kind: 'transfer_requested',
  });
  await assert.rejects(service.addManual('ws1', 'lead', -3001), TelegramGroupTransferRequestedError);
  let group = groups.get(-3001);
  assert.equal(group?.workspaceId, 'ws2', 'group stays in its workspace until approval');
  assert.equal(group?.status, 'disconnected');
  assert.deepEqual(group?.transfer, { toWorkspaceId: 'ws1', requestedByUserId: 'lead', targetStatus: 'active', requestedAt: NOW });
  assert.equal(await service.resolveChat(-3001), null);
  // Владелец ws2 видит запрос с именем пространства, куда просят перенести.
  const listed = await service.list('ws2', 'ws2owner');
  assert.equal(listed.groups[0]?.transferWorkspaceName, 'Программисты');
  // Решать может только владелец пространства группы — не руководитель и не запросивший.
  await assert.rejects(service.approveTransfer('ws2', 'ws2lead', -3001), NotWorkspaceOwnerError);
  await assert.rejects(service.approveTransfer('ws1', 'owner', -3001), TelegramGroupNotFoundError);
  await service.approveTransfer('ws2', 'ws2owner', -3001);
  group = groups.get(-3001);
  assert.equal(group?.workspaceId, 'ws1');
  assert.equal(group?.status, 'active');
  assert.equal(group?.addedByUserId, 'lead');
  assert.equal(group?.transfer, null);
  assert.equal((await service.resolveChat(-3001))?.workspaceId, 'ws1');
});

test('takeover: owner rejects the transfer; reconnecting to the own workspace works as before', async () => {
  const { service, groups } = makeService({ ws2Roles: { ws2owner: 'owner' } });
  groups.set(-3001, foreign('disconnected'));
  assert.deepEqual(await service.handleBotAdded({ id: -3001, title: 'Офис' }, 777), { kind: 'transfer_requested' });
  assert.equal(groups.get(-3001)?.transfer?.targetStatus, 'draft');
  await service.rejectTransfer('ws2', 'ws2owner', -3001);
  assert.equal(groups.get(-3001)?.transfer, null);
  assert.equal(groups.get(-3001)?.workspaceId, 'ws2');
  await assert.rejects(service.approveTransfer('ws2', 'ws2owner', -3001), TelegramGroupTransferNotFoundError);
  // Своя отключённая группа подключается обратно без одобрений.
  const own = makeService();
  own.groups.set(-3001, { ...foreign('disconnected'), workspaceId: 'ws1' });
  await own.service.createLink('ws1', 'lead', 'work');
  assert.equal((await own.service.bindFromCode(TOKEN, { id: -3001, title: 'Офис' }, 555)).kind, 'bound');
  assert.equal(own.groups.get(-3001)?.status, 'active');
});

test('takeover: an active group of another workspace cannot be taken by code, id or bot invite', async () => {
  const { service, groups } = makeService();
  groups.set(-3001, foreign('active'));
  await service.createLink('ws1', 'lead', 'work');
  assert.deepEqual(await service.bindFromCode(TOKEN, { id: -3001, title: 'Офис' }, 555), { kind: 'taken' });
  await assert.rejects(service.addManual('ws1', 'lead', -3001), TelegramGroupTakenError);
  await assert.rejects(service.confirm('ws1', 'lead', -3001), TelegramGroupNotFoundError);
  assert.deepEqual(await service.handleBotAdded({ id: -3001, title: 'Офис' }, 777), { kind: 'active' });
  assert.deepEqual(await service.chooseDraftWorkspace({ id: -3001, title: 'Офис' }, 'ws1', 777), { kind: 'active' });
  assert.deepEqual(groups.get(-3001), foreign('active'));
});

test('setMode: only owner/lead switch an active group to incidents and back', async () => {
  const { service } = makeService();
  await service.addManual('ws1', 'lead', -1001);
  await assert.rejects(service.setMode('ws1', 'viewer', -1001, 'incident'), NotWorkspaceLeadError);
  await assert.rejects(service.setMode('ws2', 'lead', -1001, 'incident'), WorkspaceNotFoundError);
  const incident = await service.setMode('ws1', 'lead', -1001, 'incident');
  assert.equal(incident.mode, 'incident');
  assert.equal((await service.resolveChat(-1001))?.mode, 'incident');
  const back = await service.setMode('ws1', 'owner', -1001, 'standard');
  assert.equal(back.mode, 'standard');
});

test('setMode: a draft or disconnected group cannot become an incident group', async () => {
  const { service } = makeService();
  await service.handleBotAdded({ id: -2005, title: 'Черновик' }, 777);
  await assert.rejects(service.setMode('ws1', 'lead', -2005, 'incident'), TelegramGroupNotFoundError);
  await service.addManual('ws1', 'lead', -1001);
  await service.handleBotRemoved(-1001);
  await assert.rejects(service.setMode('ws1', 'lead', -1001, 'incident'), TelegramGroupNotFoundError);
});

test('standardGroupInfo: только активная группа обычного режима отдаёт название для пометки задач', async () => {
  const { service, groups } = makeService();
  const base = { workspaceId: 'ws1', addedByUserId: 'lead', createdAt: NOW, invitedByTgUserId: null, projectIds: [] };
  groups.set(-3001, { ...base, chatId: -3001, title: 'Скрипты', status: 'active' });
  groups.set(-3002, { ...base, chatId: -3002, title: 'Инциденты', status: 'active', mode: 'incident' });
  groups.set(-3003, { ...base, chatId: -3003, title: 'Черновик', status: 'draft' });
  assert.deepEqual(await service.standardGroupInfo(-3001), { title: 'Скрипты' });
  assert.equal(await service.standardGroupInfo(-3002), null);
  assert.equal(await service.standardGroupInfo(-3003), null);
  assert.equal(await service.standardGroupInfo(-9999), null);
});

// Запрос на перенос — ещё и в личку владельцу прежнего пространства, с кнопками (spec, раздел 2).
function makeTransferService() {
  const store = makeRepo();
  const sent: Array<{ chatId: number; text: string; replyMarkup?: unknown }> = [];
  const roles: Record<string, Record<string, WorkspaceRole>> = {
    ws1: { lead: 'lead' },
    ws2: { ws2owner: 'owner', ws2lead: 'lead' },
  };
  const tgIds: Record<string, number> = { ws2owner: 801, ws2lead: 802, lead: 777 };
  const service = new ManageTelegramWorkGroups({
    repo: store.repo,
    workspaces: {
      async getMembership(workspaceId, userId) {
        const role = roles[workspaceId]?.[userId];
        return role ? { workspaceId, userId, role } : null;
      },
      async getById(id) {
        if (id === 'ws1') return { id, name: 'Программисты', kind: 'team' };
        if (id === 'ws2') return { id, name: 'Офис', kind: 'team' };
        return null;
      },
      async listMembers(workspaceId) {
        return Object.entries(roles[workspaceId] ?? {}).map(([userId, role]) => ({ workspaceId, userId, role }));
      },
      async listForUser(userId) {
        return userId === 'lead' ? [{ id: 'ws1', name: 'Программисты', role: 'lead' as WorkspaceRole, kind: 'team' as const }] : [];
      },
    },
    users: {
      async getTelegramLink(userId) {
        return tgIds[userId] ? { telegramUserId: tgIds[userId]! } : null;
      },
      async findUserIdByTelegramUserId(tg) {
        return Object.entries(tgIds).find(([, id]) => id === tg)?.[0] ?? null;
      },
    },
    telegram: {
      async getChat(chatId) {
        return { id: chatId, title: 'Офис', type: 'supergroup' };
      },
      async getChatAdministrators() {
        return [];
      },
      async sendMessage(input) {
        sent.push(input);
        return { ok: true, messageId: 1 } as never;
      },
    },
    botUsername: 'ProjectsFlow_Bot',
    randomToken: () => TOKEN,
    now: () => NOW,
  });
  return { service, sent, ...store };
}

test('transfer DM: only the old workspace owner gets buttons, once per request', async () => {
  const { service, groups, sent } = makeTransferService();
  groups.set(-3001, foreign('disconnected'));
  assert.deepEqual(await service.handleBotAdded({ id: -3001, title: 'Офис' }, 777), { kind: 'transfer_requested' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.chatId, 801, 'owner of ws2, not its lead');
  assert.match(sent[0]!.text, /«Офис».*«Программисты»/);
  assert.deepEqual(sent[0]!.replyMarkup, {
    inline_keyboard: [[
      { text: 'Разрешить перенос', callback_data: 'wt:a:-3001' },
      { text: 'Отклонить', callback_data: 'wt:r:-3001' },
    ]],
  });
  // Повторный запрос в то же пространство — владельца второй раз не дёргаем.
  await service.handleBotAdded({ id: -3001, title: 'Офис' }, 777);
  assert.equal(sent.length, 1);
});

test('transfer DM buttons: ownership is re-checked on press', async () => {
  const { service, groups } = makeTransferService();
  groups.set(-3001, foreign('disconnected'));
  await service.handleBotAdded({ id: -3001, title: 'Офис' }, 777);
  assert.deepEqual(await service.decideTransferFromTelegram(-3001, 802, true), { kind: 'forbidden' });
  assert.deepEqual(await service.decideTransferFromTelegram(-3001, 999, true), { kind: 'forbidden' });
  assert.equal(groups.get(-3001)?.workspaceId, 'ws2');
  assert.deepEqual(await service.decideTransferFromTelegram(-3001, 801, true), {
    kind: 'approved',
    groupTitle: 'Офис',
    toWorkspaceName: 'Программисты',
  });
  assert.equal(groups.get(-3001)?.workspaceId, 'ws1');
  assert.equal(groups.get(-3001)?.status, 'draft');
  // Повторное нажатие после решения — запроса уже нет.
  assert.deepEqual(await service.decideTransferFromTelegram(-3001, 801, true), { kind: 'not_found' });
});

test('transfer DM buttons: owner rejects, group stays disconnected in the old workspace', async () => {
  const { service, groups } = makeTransferService();
  groups.set(-3001, foreign('disconnected'));
  await service.handleBotAdded({ id: -3001, title: 'Офис' }, 777);
  assert.equal((await service.decideTransferFromTelegram(-3001, 801, false)).kind, 'rejected');
  assert.equal(groups.get(-3001)?.workspaceId, 'ws2');
  assert.equal(groups.get(-3001)?.status, 'disconnected');
  assert.equal(groups.get(-3001)?.transfer, null);
});

test('onActivated: снимок участников при подключении — вручную, подтверждением черновика; сбой не мешает', async () => {
  const activated: number[] = [];
  const { service } = makeService();
  (service as unknown as { deps: { onActivated: (c: number) => Promise<void> } }).deps.onActivated = async (c) => {
    activated.push(c);
    if (c === -2005) throw new Error('telegram down');
  };
  await service.addManual('ws1', 'lead', -1001);
  await service.handleBotAdded({ id: -2005, title: 'Поддержка' }, 777);
  assert.deepEqual(activated, [-1001], 'a draft does not snapshot members');
  const group = await service.confirm('ws1', 'owner', -2005);
  assert.equal(group.status, 'active');
  await service.confirm('ws1', 'owner', -2005);
  assert.deepEqual(activated, [-1001, -2005], 'confirming an active group again does nothing');
});

test('setMode: смешанный режим включают владелец/руководитель; для пометки задач группа как обычная', async () => {
  const { service } = makeService();
  await service.addManual('ws1', 'lead', -1001);
  await assert.rejects(service.setMode('ws1', 'viewer', -1001, 'mixed'), NotWorkspaceLeadError);
  const mixed = await service.setMode('ws1', 'lead', -1001, 'mixed');
  assert.equal(mixed.mode, 'mixed');
  assert.equal((await service.resolveChat(-1001))?.mode, 'mixed');
  assert.notEqual(await service.standardGroupInfo(-1001), null);
  const back = await service.setMode('ws1', 'owner', -1001, 'standard');
  assert.equal(back.mode, 'standard');
});
