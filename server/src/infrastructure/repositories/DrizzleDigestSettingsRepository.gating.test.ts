import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrizzleDigestSettingsRepository } from './DrizzleDigestSettingsRepository.js';
import { fakeDb } from './fakeDrizzleDb.js';
import type { ProjectMemberRepository, ProjectWithRole } from '../../application/project/ProjectMemberRepository.js';
import type { Database } from '../db/index.js';

// Регресс-тест того же класса бага, что #блокер3..5 (ef0cea3): ветка (A) «мои проекты» в
// listGroupsForUser гейтила выдачу прямым `.innerJoin(projectMembers, ...)` — ws-приглашённый
// юзер без ленивой project_members-строки получал пустую ветку А. Фикс делегирует ветку А в
// ProjectMemberRepository.listProjectsForUser (единое пространство) — проверяем именно это
// делегирование (реальной тестовой БД для Drizzle-репо в этом кодбейзе нет, см.
// fakeDrizzleDb.ts). Ветка (B) — проекты пространства текущего projectId — не завязана на
// project_members и здесь не меняется, но покрыта, чтобы убедиться, что объединение веток
// по-прежнему работает.

function fakeProjectMembers(projects: readonly Partial<ProjectWithRole>[]): ProjectMemberRepository {
  return {
    listProjectsForUser: async () => projects as ProjectWithRole[],
  } as unknown as ProjectMemberRepository;
}

test('listGroupsForUser: ws-участник БЕЗ project_members-строки — видит группу своего проекта (ветка А через ProjectMemberRepository)', async () => {
  const db = fakeDb({
    selectRowsSeq: [
      [{ chatId: 111, title: 'Группа A' }], // (A) мои проекты
      [{ workspaceId: 'w1' }], // resolve workspaceId текущего projectId
      [], // (B) остальные проекты пространства — пусто
    ],
  }) as unknown as Database;
  const repo = new DrizzleDigestSettingsRepository(db, fakeProjectMembers([{ id: 'p1' }]));

  const result = await repo.listGroupsForUser('u1', 'p1');
  assert.deepEqual(result, [{ chatId: 111, title: 'Группа A' }]);
});

test('listGroupsForUser: у юзера нет доступных проектов (пустой список от ProjectMemberRepository) — ветка А пуста БЕЗ похода в БД, ветка Б отрабатывает как обычно', async () => {
  let selectCount = 0;
  const db = fakeDb({
    selectRowsSeq: [
      [{ workspaceId: 'w1' }], // resolve workspaceId (первый реальный select — ветка А пропущена)
      [{ chatId: 222, title: 'Группа B' }], // (B) проекты пространства
    ],
    onSelect: () => {
      selectCount += 1;
    },
  }) as unknown as Database;
  const repo = new DrizzleDigestSettingsRepository(db, fakeProjectMembers([]));

  const result = await repo.listGroupsForUser('u1', 'p1');
  assert.deepEqual(result, [{ chatId: 222, title: 'Группа B' }]);
  assert.equal(selectCount, 2, 'ветка А не должна ходить в БД, если у юзера нет доступных проектов');
});
