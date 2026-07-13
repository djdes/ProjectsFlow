import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrizzleTaskSearchRepository } from './DrizzleTaskSearchRepository.js';
import { fakeDb } from './fakeDrizzleDb.js';
import type { ProjectMemberRepository, ProjectWithRole } from '../../application/project/ProjectMemberRepository.js';
import type { Database } from '../db/index.js';

// Регресс-тест #блокер4: скоуп-поиск задач (`!includeAllProjects`) отдавал 0 результатов для
// ws-участника без ленивой project_members-строки — старый код innerJoin'ил project_members
// напрямую. Фикс делегирует ПОЛНОСТЬЮ в ProjectMemberRepository.listProjectsForUser (единое
// пространство) — проверяем это делегирование (реальной тестовой БД для Drizzle-репо в этом
// кодбейзе нет, см. fakeDrizzleDb.ts).

function fakeProjectMembers(projects: readonly Partial<ProjectWithRole>[]): ProjectMemberRepository {
  return {
    listProjectsForUser: async () => projects as ProjectWithRole[],
  } as unknown as ProjectMemberRepository;
}

test('search (!includeAllProjects): ws-участник БЕЗ project_members-строки — находит задачу своего проекта', async () => {
  const taskRow = {
    taskId: 't1',
    projectId: 'p1',
    projectName: 'Проект',
    status: 'todo',
    description: 'найди меня плз',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  const db = fakeDb({ selectRows: [taskRow] }) as unknown as Database;
  const repo = new DrizzleTaskSearchRepository(db, fakeProjectMembers([{ id: 'p1' }]));

  const result = await repo.search({ userId: 'u1', query: 'найди', includeAllProjects: false, limit: 20 });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.taskId, 't1');
});

test('search (!includeAllProjects): у юзера нет доступных проектов (пустой список от ProjectMemberRepository) — пусто, БЕЗ похода в БД', async () => {
  let selectCalled = false;
  const db = fakeDb({ selectRows: [{ taskId: 'leak' }], onSelect: () => { selectCalled = true; } }) as unknown as Database;
  const repo = new DrizzleTaskSearchRepository(db, fakeProjectMembers([]));

  const result = await repo.search({ userId: 'u1', query: 'x', includeAllProjects: false, limit: 20 });
  assert.deepEqual(result, []);
  assert.equal(selectCalled, false, 'не должно быть похода в БД, если у юзера нет доступных проектов');
});

test('search (includeAllProjects=true): НЕ зовёт ProjectMemberRepository (админ-поиск по всем проектам без скоупа)', async () => {
  let projectMembersCalled = false;
  const taskRow = {
    taskId: 't1',
    projectId: 'p1',
    projectName: 'Проект',
    status: 'todo',
    description: 'x',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  const db = fakeDb({ selectRows: [taskRow] }) as unknown as Database;
  const projectMembers = {
    listProjectsForUser: async () => {
      projectMembersCalled = true;
      return [];
    },
  } as unknown as ProjectMemberRepository;
  const repo = new DrizzleTaskSearchRepository(db, projectMembers);

  const result = await repo.search({ userId: 'admin', query: 'x', includeAllProjects: true, limit: 20 });
  assert.equal(result.length, 1);
  assert.equal(projectMembersCalled, false);
});
