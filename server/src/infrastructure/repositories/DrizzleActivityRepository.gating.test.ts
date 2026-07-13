import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrizzleActivityRepository } from './DrizzleActivityRepository.js';
import { fakeDb } from './fakeDrizzleDb.js';
import type { ProjectMemberRepository, ProjectWithRole } from '../../application/project/ProjectMemberRepository.js';
import type { Database } from '../db/index.js';

// Регресс-тест #блокер3: лента «Активность» («Все») была пуста для ws-участника без
// ленивой project_members-строки — старый код гейтил `.innerJoin(projectMembers, ...)`
// напрямую. Фикс делегирует ПОЛНОСТЬЮ в ProjectMemberRepository.listProjectsForUserInWorkspace
// (единое пространство, workspace_members + is_inbox→owner) — здесь проверяем именно это
// делегирование, а не SQL (реальной тестовой БД в этом кодбейзе нет ни для одного
// Drizzle-репо, см. fakeDrizzleDb.ts).

function fakeProjectMembers(projects: readonly Partial<ProjectWithRole>[]): ProjectMemberRepository {
  return {
    listProjectsForUserInWorkspace: async () => projects as ProjectWithRole[],
  } as unknown as ProjectMemberRepository;
}

test('listForUserInWorkspace: ws-участник БЕЗ project_members-строки — видит событие своего проекта (делегирование в ProjectMemberRepository, не project_members-join)', async () => {
  const event = {
    id: 'e1',
    workspaceId: 'w1',
    projectId: 'p1',
    actorUserId: 'u2',
    kind: 'task_created',
    payload: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  const db = fakeDb({ selectRows: [event] }) as unknown as Database;
  const repo = new DrizzleActivityRepository(db, fakeProjectMembers([{ id: 'p1' }]));

  const result = await repo.listForUserInWorkspace('u1', 'w1', { limit: 20 });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, 'e1');
  assert.equal(result[0]!.projectId, 'p1');
});

test('listForUserInWorkspace: юзер НЕ участник пространства (пустой список от ProjectMemberRepository) — пусто, БЕЗ похода в БД', async () => {
  let selectCalled = false;
  const db = fakeDb({ selectRows: [{ id: 'leak' }], onSelect: () => { selectCalled = true; } }) as unknown as Database;
  const repo = new DrizzleActivityRepository(db, fakeProjectMembers([]));

  const result = await repo.listForUserInWorkspace('u1', 'w1', { limit: 20 });
  assert.deepEqual(result, []);
  assert.equal(selectCalled, false, 'не должно быть похода в БД, если у юзера нет доступных проектов');
});
