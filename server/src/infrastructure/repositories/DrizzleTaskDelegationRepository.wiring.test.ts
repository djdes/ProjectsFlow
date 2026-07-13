import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrizzleTaskDelegationRepository } from './DrizzleTaskDelegationRepository.js';
import { fakeDb } from './fakeDrizzleDb.js';
import { ListTasksAssignedToMe } from '../../application/task/ListTasksAssignedToMe.js';
import type {
  ProjectMemberRepository,
  ProjectWithRole,
} from '../../application/project/ProjectMemberRepository.js';
import type { ProjectMembership, ProjectRole } from '../../domain/project/ProjectMembership.js';
import type { Database } from '../db/index.js';

// Wiring-регресс-тесты блокеров #1/#2 (Fix pass 2). Чистые функции
// resolveAssignedRows/resolveDelegatedToOthersRows уже покрыты в *.gating.test.ts, НО они не
// ловят регрессию на уровне МЕТОДА репозитория: если кто-то вернёт корелированный подзапрос
// `SELECT pm.role FROM project_members` ВНУТРЬ listAssignedTo/listDelegatedToOthers (или
// перестанет строить roleByProject/callerRoleByProject из порта перед вызовом чистой функции) —
// unit-тест чистой функции этого не заметит. Именно так баг и проскочил в первый раз.
//
// Здесь инстанцируется РЕАЛЬНЫЙ DrizzleTaskDelegationRepository с fakeDb (отдаёт делегации) +
// fake ProjectMemberRepository (знает членство/роль через workspace_members, БЕЗ какой-либо
// project_members-строки). Доказываем: роль/членство метод берёт ИЗ ПОРТА, а не из БД —
// ws-участник без project_members-строки видит делегированное.

// Полный сырой ряд join'а (проекция listAssignedTo/selectDelegatedToOthers) — fakeDb отдаёт
// его как есть; delegateRole/callerRole в проекции НЕТ (в этом суть фикса — роль из порта).
function rawRow(over: {
  taskId?: string;
  projectId?: string;
  isInbox?: boolean;
  delegateUserId?: string;
}) {
  return {
    id: 'd1',
    taskId: over.taskId ?? 't1',
    delegateUserId: over.delegateUserId ?? 'me',
    delegateDisplayName: 'Делегат',
    delegateAvatarUrl: null,
    delegatorUserId: 'creator-1',
    revertToUserId: null,
    ownerId: 'owner-1',
    delegatorDisplayName: 'Создатель',
    delegatorAvatarUrl: null,
    ownerDisplayName: 'Владелец',
    ownerAvatarUrl: null,
    status: 'accepted' as const,
    createdAt: new Date(0),
    respondedAt: new Date(0),
    projectId: over.projectId ?? 'p1',
    projectName: 'Проект',
    isInbox: over.isInbox ?? false,
  };
}

// Fake-порт: членство/роль резолвятся ЧЕРЕЗ ПРОСТРАНСТВО (эмулируем listProjectsForUser /
// findForProject эталонного DrizzleProjectMemberRepository). project_members здесь нет вообще.
function fakePort(over: {
  projects?: readonly Partial<ProjectWithRole>[];
  findRole?: (projectId: string, userId: string) => ProjectRole | null;
}): ProjectMemberRepository {
  return {
    listProjectsForUser: async () => (over.projects ?? []) as ProjectWithRole[],
    findForProject: async (projectId: string, userId: string): Promise<ProjectMembership | null> => {
      const role = over.findRole ? over.findRole(projectId, userId) : null;
      return role ? { projectId, userId, role, joinedAt: new Date(0) } : null;
    },
  } as unknown as ProjectMemberRepository;
}

// === Блокер #1 — listAssignedTo («Поручено мне») ===

test('listAssignedTo: делегат-ws-участник БЕЗ project_members-строки — delegateRole берётся из порта (editor), строка НЕ теряется', async () => {
  const db = fakeDb({ selectRows: [rawRow({ projectId: 'p1', isInbox: false })] }) as unknown as Database;
  // Порт знает 'me' как editor'а проекта p1 (через workspace_members) — но никакой
  // project_members-строки нет: если бы метод читал роль из БД, delegateRole был бы null.
  const repo = new DrizzleTaskDelegationRepository(db, fakePort({ projects: [{ id: 'p1', role: 'editor', isInbox: false }] }));

  const rows = await repo.listAssignedTo('me');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.delegateRole, 'editor');
});

test('listAssignedTo → ListTasksAssignedToMe: ws-участник (editor из порта) — задача visible И canModify=true (полная цепочка репо+use-case)', async () => {
  const db = fakeDb({ selectRows: [rawRow({ taskId: 't1', projectId: 'p1', isInbox: false })] }) as unknown as Database;
  const repo = new DrizzleTaskDelegationRepository(db, fakePort({ projects: [{ id: 'p1', role: 'editor', isInbox: false }] }));

  const useCase = new ListTasksAssignedToMe({
    delegations: repo,
    tasks: {
      listByIds: async (ids: readonly string[]) =>
        ids.map((id) => ({ id, projectId: 'p1', description: 'x' })),
    } as never,
    taskCommits: { countsByTasks: async () => new Map<string, number>() } as never,
    attachments: { countsByTasks: async () => new Map<string, number>() } as never,
    comments: { countsByTasks: async () => new Map<string, number>() } as never,
  });

  const items = await useCase.execute('me');
  assert.equal(items.length, 1, 'ws-участник без project_members-строки НЕ должен выпадать из «Поручено мне»');
  assert.equal(items[0]!.canModify, true);
});

test('listAssignedTo: делегат БЕЗ доступа (порт не знает проект) — delegateRole=null (для именованного проекта use-case это отфильтрует)', async () => {
  const db = fakeDb({ selectRows: [rawRow({ projectId: 'p1', isInbox: false })] }) as unknown as Database;
  const repo = new DrizzleTaskDelegationRepository(db, fakePort({ projects: [] }));

  const rows = await repo.listAssignedTo('me');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.delegateRole, null);
});

// === Блокер #2 — listDelegatedToOthers («Другим») ===

test('listDelegatedToOthers: caller-ws-участник БЕЗ project_members-строки — видит делегации named-проекта, callerRole из порта (editor)', async () => {
  let selectCount = 0;
  // named-ветка (select #1) отдаёт делегацию в p1; inbox-ветка (select #2) — пусто.
  const db = fakeDb({
    selectRowsSeq: [[rawRow({ projectId: 'p1', isInbox: false, delegateUserId: 'other' })], []],
    onSelect: () => { selectCount += 1; },
  }) as unknown as Database;
  const repo = new DrizzleTaskDelegationRepository(
    db,
    // Порт знает 'me' как editor'а p1 (workspace_members) → memberProjectIds=[p1] → named-ветка
    // выполняется. delegateRole делегата 'other' резолвится через findForProject (viewer).
    fakePort({
      projects: [{ id: 'p1', role: 'editor', isInbox: false }],
      findRole: () => 'viewer',
    }),
  );

  const rows = await repo.listDelegatedToOthers('me');
  assert.equal(selectCount, 2, 'named + inbox ветки должны обе выполниться (member знает проект из порта)');
  assert.equal(rows.length, 1, 'делегация named-проекта НЕ должна быть пустой для ws-участника');
  assert.equal(rows[0]!.callerRole, 'editor');
  assert.equal(rows[0]!.delegateRole, 'viewer');
});

test('listDelegatedToOthers: caller НЕ участник (порт вернул []) — named-ветка НЕ выполняется (гейт через порт, не project_members)', async () => {
  let selectCount = 0;
  const db = fakeDb({ selectRows: [], onSelect: () => { selectCount += 1; } }) as unknown as Database;
  const repo = new DrizzleTaskDelegationRepository(db, fakePort({ projects: [] }));

  const rows = await repo.listDelegatedToOthers('me');
  // memberProjectIds пусто → named-ветка короткозамкнута ([]); выполняется ТОЛЬКО inbox-select.
  assert.equal(selectCount, 1, 'named-ветка должна быть пропущена, если порт не знает caller-а участником');
  assert.deepEqual(rows, []);
});
