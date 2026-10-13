import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIVATE_CHOICE_TTL_MS,
  resolveDraftWorkspace,
  sortWorkspaceOptions,
  type ComposerWorkspaceDeps,
  type WorkspaceOption,
} from './resolveDraftWorkspace.js';

const ME: WorkspaceOption = { id: 'w-me', name: 'Личное', icon: null, kind: 'default' };
const TEAM: WorkspaceOption = { id: 'w-team', name: 'Команда', icon: '🚀', kind: 'team' };
const STUDIO: WorkspaceOption = { id: 'w-studio', name: 'Студия', icon: null, kind: 'team' };

const NOW = new Date('2026-10-13T12:00:00Z');
const PRIVATE_CHAT = 500;
const GROUP_CHAT = -100500;

function deps(opts: {
  mine: WorkspaceOption[];
  // Кто ещё состоит в пространстве (автор состоит во всех своих).
  members?: Record<string, string[]>;
  linked?: string[];
  choice?: { workspaceId: string; chosenAt: Date } | null;
}): ComposerWorkspaceDeps {
  return {
    listForUser: async () => opts.mine,
    isMember: async (workspaceId, userId) =>
      userId === 'me'
        ? opts.mine.some((w) => w.id === workspaceId)
        : (opts.members?.[workspaceId] ?? []).includes(userId),
    chats: {
      linkedWorkspaceIds: async () => opts.linked ?? [],
      getChoice: async () => opts.choice ?? null,
      saveChoice: async () => {},
    },
  };
}

const input = (over: Partial<Parameters<typeof resolveDraftWorkspace>[1]> = {}) => ({
  userId: 'me',
  chatId: PRIVATE_CHAT,
  delegateIds: [],
  now: NOW,
  ...over,
});

test('нет пространств — решать не из чего (null, прежнее поведение)', async () => {
  assert.equal(await resolveDraftWorkspace(deps({ mine: [] }), input()), null);
});

test('одно пространство — оно, без вопроса', async () => {
  assert.deepEqual(await resolveDraftWorkspace(deps({ mine: [TEAM] }), input()), {
    kind: 'resolved',
    workspaceId: 'w-team',
    reason: 'only',
  });
});

test('несколько пространств и никаких подсказок — спросить, личное первым', async () => {
  const decision = await resolveDraftWorkspace(deps({ mine: [TEAM, ME, STUDIO] }), input());
  assert.equal(decision?.kind, 'ask');
  assert.deepEqual(
    decision?.kind === 'ask' ? decision.options.map((w) => w.id) : [],
    ['w-me', 'w-team', 'w-studio'],
  );
});

test('ответственный состоит в одном из пространств — туда, без вопроса', async () => {
  const decision = await resolveDraftWorkspace(
    deps({ mine: [ME, TEAM, STUDIO], members: { 'w-team': ['vasya'] } }),
    input({ delegateIds: ['vasya'] }),
  );
  assert.deepEqual(decision, { kind: 'resolved', workspaceId: 'w-team', reason: 'assignee' });
});

test('ответственный в двух — спросить только среди общих', async () => {
  const decision = await resolveDraftWorkspace(
    deps({ mine: [ME, TEAM, STUDIO], members: { 'w-team': ['vasya'], 'w-studio': ['vasya'] } }),
    input({ delegateIds: ['vasya'] }),
  );
  assert.equal(decision?.kind, 'ask');
  assert.deepEqual(
    decision?.kind === 'ask' ? decision.options.map((w) => w.id) : [],
    ['w-team', 'w-studio'],
  );
});

test('группа привязана к пространству — туда, без вопроса', async () => {
  const decision = await resolveDraftWorkspace(
    deps({ mine: [ME, TEAM, STUDIO], linked: ['w-studio'] }),
    input({ chatId: GROUP_CHAT }),
  );
  assert.deepEqual(decision, { kind: 'resolved', workspaceId: 'w-studio', reason: 'group' });
});

test('группа привязана к пространству, где автора нет, — привязка не в счёт', async () => {
  const decision = await resolveDraftWorkspace(
    deps({ mine: [ME, TEAM], linked: ['w-foreign'] }),
    input({ chatId: GROUP_CHAT }),
  );
  assert.equal(decision?.kind, 'ask');
});

test('группа привязана к двум — спросить только среди них', async () => {
  const decision = await resolveDraftWorkspace(
    deps({ mine: [ME, TEAM, STUDIO], linked: ['w-team', 'w-studio'] }),
    input({ chatId: GROUP_CHAT }),
  );
  assert.equal(decision?.kind, 'ask');
  assert.deepEqual(
    decision?.kind === 'ask' ? decision.options.map((w) => w.id) : [],
    ['w-team', 'w-studio'],
  );
});

test('личка: свежий прошлый выбор — без вопроса', async () => {
  const decision = await resolveDraftWorkspace(
    deps({ mine: [ME, TEAM], choice: { workspaceId: 'w-team', chosenAt: new Date(NOW.getTime() - 60_000) } }),
    input(),
  );
  assert.deepEqual(decision, { kind: 'resolved', workspaceId: 'w-team', reason: 'remembered' });
});

test('личка: выбор старше 12 часов — снова спросить', async () => {
  const decision = await resolveDraftWorkspace(
    deps({
      mine: [ME, TEAM],
      choice: { workspaceId: 'w-team', chosenAt: new Date(NOW.getTime() - PRIVATE_CHOICE_TTL_MS - 1) },
    }),
    input(),
  );
  assert.equal(decision?.kind, 'ask');
});

test('группа: прошлый выбор не стареет', async () => {
  const decision = await resolveDraftWorkspace(
    deps({
      mine: [ME, TEAM],
      choice: { workspaceId: 'w-team', chosenAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000) },
    }),
    input({ chatId: GROUP_CHAT }),
  );
  assert.deepEqual(decision, { kind: 'resolved', workspaceId: 'w-team', reason: 'remembered' });
});

test('прошлый выбор, где ответственного нет, — не в счёт', async () => {
  const decision = await resolveDraftWorkspace(
    deps({
      mine: [ME, TEAM, STUDIO],
      members: { 'w-team': ['vasya'], 'w-studio': ['vasya'] },
      choice: { workspaceId: 'w-me', chosenAt: NOW },
    }),
    input({ delegateIds: ['vasya'] }),
  );
  assert.equal(decision?.kind, 'ask');
});

test('сортировка: личное первым, командные по имени', () => {
  assert.deepEqual(
    sortWorkspaceOptions([STUDIO, TEAM, ME]).map((w) => w.id),
    ['w-me', 'w-team', 'w-studio'],
  );
});

test('поручение в двух общих пространствах всегда требует выбора, даже с привязкой группы и прошлым выбором', async () => {
  const decision = await resolveDraftWorkspace(deps({ mine: [ME, TEAM, STUDIO],
    members: { 'w-team': ['vasya'], 'w-studio': ['vasya'] }, linked: ['w-team'],
    choice: { workspaceId: 'w-team', chosenAt: NOW } }), input({ chatId: GROUP_CHAT, delegateIds: ['vasya'] }));
  assert.equal(decision?.kind, 'ask');
  assert.deepEqual(decision?.kind === 'ask' ? decision.options.map((w) => w.id) : [], ['w-team', 'w-studio']);
});

test('единственное пространство автора без исполнителя не становится допустимым', async () => {
  const decision = await resolveDraftWorkspace(deps({ mine: [TEAM] }), input({ delegateIds: ['vasya'] }));
  assert.deepEqual(decision, { kind: 'ask', options: [] });
});

test('учитывается автор поручения, чужие пространства исполнителя не предлагаются', async () => {
  const decision = await resolveDraftWorkspace(deps({ mine: [TEAM, ME],
    members: { 'w-team': ['vasya'], 'w-studio': ['vasya'] } }), input({ delegateIds: ['vasya'] }));
  assert.deepEqual(decision, { kind: 'resolved', workspaceId: TEAM.id, reason: 'assignee' });
});
