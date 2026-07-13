import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAssignedRows,
  resolveDelegatedToOthersRows,
} from './DrizzleTaskDelegationRepository.js';
import type { ProjectRole } from '../../domain/project/ProjectMembership.js';
import type { TaskDelegationStatus } from '../../domain/task/TaskDelegation.js';

// Регресс-тесты #блокер1 («Поручено мне» прячет делегированные задачи) и #блокер2
// (вкладка «Другим» пуста). Оба бага были в том, что delegateRole/callerRole резолвились
// корелированным подзапросом К `project_members` — NULL для ws-участника без ленивой
// строки (project_members теперь только per-member настройки, см.
// DrizzleProjectMemberRepository.ts). Фикс: роль резолвится из карт, построенных
// ProjectMemberRepository.listProjectsForUser/findForProject (единое пространство,
// workspace_members). Ниже — карты СПЕЦИАЛЬНО построены БЕЗ единой ссылки на project_members
// (сигнатуры чистых функций даже не знают о существовании этой таблицы), имитируя ровно
// сценарий «ws-участник без project_members-строки».

function rawRow(over: {
  projectId?: string;
  isInbox?: boolean;
  delegateUserId?: string;
  status?: TaskDelegationStatus;
}) {
  return {
    id: 'd1',
    taskId: 't1',
    delegateUserId: over.delegateUserId ?? 'delegate-1',
    delegateDisplayName: 'Делегат',
    delegateAvatarUrl: null,
    delegatorUserId: 'creator-1',
    revertToUserId: null,
    ownerId: 'owner-1',
    delegatorDisplayName: 'Создатель',
    delegatorAvatarUrl: null,
    ownerDisplayName: 'Владелец',
    ownerAvatarUrl: null,
    status: over.status ?? 'accepted',
    createdAt: new Date(0),
    respondedAt: new Date(0),
    projectId: over.projectId ?? 'p1',
    projectName: 'Проект',
    isInbox: over.isInbox ?? false,
  };
}

// --- resolveAssignedRows (#блокер1 — «Поручено мне») ---

test('resolveAssignedRows: ws-участник БЕЗ project_members-строки — роль резолвится из карты workspace_members, delegateRole != null', () => {
  // roleByProject строится ТОЛЬКО из ProjectWithRole[] (listProjectsForUser) — никакого
  // project_members в этой карте нет и быть не может по типу.
  const roleByProject = new Map<string, ProjectRole>([['p1', 'editor']]);
  const [row] = resolveAssignedRows([rawRow({ projectId: 'p1', isInbox: false })], roleByProject);
  assert.equal(row!.delegateRole, 'editor');
});

test('resolveAssignedRows: юзера убрали из пространства (нет записи в roleByProject) — delegateRole=null (для именованного проекта use-case это отфильтрует строку)', () => {
  const roleByProject = new Map<string, ProjectRole>();
  const [row] = resolveAssignedRows([rawRow({ projectId: 'p1', isInbox: false })], roleByProject);
  assert.equal(row!.delegateRole, null);
});

test('resolveAssignedRows: inbox-строка — delegateRole может быть null, это норма (видимость решает isInbox, не роль)', () => {
  const roleByProject = new Map<string, ProjectRole>([['p1', 'owner']]);
  const [row] = resolveAssignedRows([rawRow({ projectId: 'p1', isInbox: true })], roleByProject);
  assert.equal(row!.isInbox, true);
});

// --- resolveDelegatedToOthersRows (#блокер2 — вкладка «Другим») ---

test('resolveDelegatedToOthersRows: ws-участник БЕЗ project_members-строки — callerRole резолвится из карты, строка видима', () => {
  const callerRoleByProject = new Map<string, ProjectRole>([['p1', 'viewer']]);
  const delegateRoleByPair = new Map<string, ProjectRole | null>([['p1:delegate-1', 'editor']]);
  const [row] = resolveDelegatedToOthersRows(
    [rawRow({ projectId: 'p1', isInbox: false, delegateUserId: 'delegate-1' })],
    callerRoleByProject,
    delegateRoleByPair,
  );
  assert.equal(row!.callerRole, 'viewer');
  assert.equal(row!.delegateRole, 'editor');
});

test('resolveDelegatedToOthersRows: caller не найден ни в одной карте (не ws-участник) — callerRole=null (use-case это отфильтрует)', () => {
  const [row] = resolveDelegatedToOthersRows(
    [rawRow({ projectId: 'p1', isInbox: false })],
    new Map(),
    new Map(),
  );
  assert.equal(row!.callerRole, null);
});

test('resolveDelegatedToOthersRows: delegateRoleByPair различает делегатов по (projectId,delegateUserId) — не путает роли двух разных делегатов в одном проекте', () => {
  const callerRoleByProject = new Map<string, ProjectRole>([['p1', 'owner']]);
  const delegateRoleByPair = new Map<string, ProjectRole | null>([
    ['p1:delegate-A', 'editor'],
    ['p1:delegate-B', null], // делегата B убрали из проекта
  ]);
  const rows = resolveDelegatedToOthersRows(
    [
      rawRow({ projectId: 'p1', delegateUserId: 'delegate-A' }),
      rawRow({ projectId: 'p1', delegateUserId: 'delegate-B' }),
    ],
    callerRoleByProject,
    delegateRoleByPair,
  );
  assert.equal(rows[0]!.delegateRole, 'editor');
  assert.equal(rows[1]!.delegateRole, null);
});

test('resolveDelegatedToOthersRows: inbox-строка — caller (владелец) резолвится через свою же карту (listProjectsForUser включает собственный inbox с ролью owner)', () => {
  const callerRoleByProject = new Map<string, ProjectRole>([['inbox-1', 'owner']]);
  const [row] = resolveDelegatedToOthersRows(
    [rawRow({ projectId: 'inbox-1', isInbox: true })],
    callerRoleByProject,
    new Map(),
  );
  assert.equal(row!.callerRole, 'owner');
  assert.equal(row!.isInbox, true);
});
