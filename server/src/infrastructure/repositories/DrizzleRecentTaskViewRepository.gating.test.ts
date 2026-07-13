import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrizzleRecentTaskViewRepository } from './DrizzleRecentTaskViewRepository.js';
import { fakeDb } from './fakeDrizzleDb.js';
import type { ProjectMemberRepository, ProjectWithRole } from '../../application/project/ProjectMemberRepository.js';
import type { ProjectMembership } from '../../domain/project/ProjectMembership.js';
import type { Database } from '../db/index.js';

// Регресс-тест #блокер5: recordView тихо игнорировал открытие задачи, а listRecent отдавал
// 0 строк для ws-участника без ленивой project_members-строки — старый код гейтил через
// `.innerJoin(projectMembers, ...)`. Фикс делегирует ПОЛНОСТЬЮ в ProjectMemberRepository
// (findForProject / listProjectsForUser, единое пространство) — проверяем это делегирование
// (реальной тестовой БД для Drizzle-репо в этом кодбейзе нет, см. fakeDrizzleDb.ts).

test('recordView: ws-участник БЕЗ project_members-строки (findForProject возвращает membership через workspace_members) — запись СОЗДАЁТСЯ', async () => {
  const insertedValues: unknown[] = [];
  const db = fakeDb({
    selectRows: [{ projectId: 'p1' }],
    onInsertValues: (v) => insertedValues.push(v),
  }) as unknown as Database;
  const projectMembers = {
    findForProject: async () =>
      ({ projectId: 'p1', userId: 'u1', role: 'editor', joinedAt: new Date() }) satisfies ProjectMembership,
  } as unknown as ProjectMemberRepository;
  const repo = new DrizzleRecentTaskViewRepository(db, projectMembers);

  await repo.recordView('u1', 't1');
  assert.equal(insertedValues.length, 1);
  assert.deepEqual(insertedValues[0], { userId: 'u1', taskId: 't1', projectId: 'p1' });
});

test('recordView: юзер не имеет доступа к проекту задачи (findForProject → null) — запись НЕ создаётся (тихий no-op)', async () => {
  const insertedValues: unknown[] = [];
  const db = fakeDb({
    selectRows: [{ projectId: 'p1' }],
    onInsertValues: (v) => insertedValues.push(v),
  }) as unknown as Database;
  const projectMembers = {
    findForProject: async () => null,
  } as unknown as ProjectMemberRepository;
  const repo = new DrizzleRecentTaskViewRepository(db, projectMembers);

  await repo.recordView('u1', 't1');
  assert.equal(insertedValues.length, 0);
});

function fakeProjectMembers(projects: readonly Partial<ProjectWithRole>[]): ProjectMemberRepository {
  return {
    listProjectsForUser: async () => projects as ProjectWithRole[],
  } as unknown as ProjectMemberRepository;
}

test('listRecent: ws-участник БЕЗ project_members-строки — видит свой недавно открытый таск', async () => {
  const row = {
    taskId: 't1',
    projectId: 'p1',
    projectName: 'Проект',
    projectIcon: null,
    projectIsInbox: false,
    description: 'x',
    status: 'todo',
    viewedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const db = fakeDb({ selectRows: [row] }) as unknown as Database;
  const repo = new DrizzleRecentTaskViewRepository(db, fakeProjectMembers([{ id: 'p1' }]));

  const result = await repo.listRecent('u1', 20);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.taskId, 't1');
});

test('listRecent: у юзера нет доступных проектов (пустой список от ProjectMemberRepository) — пусто, БЕЗ похода в БД', async () => {
  let selectCalled = false;
  const db = fakeDb({ selectRows: [{ taskId: 'leak' }], onSelect: () => { selectCalled = true; } }) as unknown as Database;
  const repo = new DrizzleRecentTaskViewRepository(db, fakeProjectMembers([]));

  const result = await repo.listRecent('u1', 20);
  assert.deepEqual(result, []);
  assert.equal(selectCalled, false, 'не должно быть похода в БД, если у юзера нет доступных проектов');
});
