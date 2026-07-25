import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrizzleAutomationRepository } from './DrizzleAutomationRepository.js';
import { fakeDb } from './fakeDrizzleDb.js';
import type { Database } from '../db/index.js';

// Пер-проектная включённость сверки из чеклиста пространства. Реальной тестовой БД для Drizzle
// в этом кодбейзе нет (см. fakeDrizzleDb.ts) — проверяем ЛОГИКУ, которую репозиторий передаёт в
// insert().values(): какой commit_sync_enabled ставится каждому проекту и когда сбрасывается
// commit_sync_last_run_on. onDuplicateKeyUpdate.set в коде несёт те же значения, что и values.

type InsertValues = {
  projectId: string;
  commitSyncEnabled?: boolean;
  commitSyncLastRunOn?: string | null;
};

test('listWorkspaceProjectsCommitSync: проект без строки автоматизации считается выключенным', async () => {
  const db = fakeDb({
    selectRows: [
      { id: 'p1', name: 'Alpha', icon: '🚀', enabled: true },
      { id: 'p2', name: 'Beta', icon: null, enabled: false },
      { id: 'p3', name: 'Gamma', icon: null, enabled: null }, // нет строки → left join даёт null
    ],
  }) as unknown as Database;
  const repo = new DrizzleAutomationRepository(db);

  const result = await repo.listWorkspaceProjectsCommitSync('w1');

  assert.deepEqual(result, [
    { id: 'p1', name: 'Alpha', icon: '🚀', commitSyncEnabled: true },
    { id: 'p2', name: 'Beta', icon: null, commitSyncEnabled: false },
    { id: 'p3', name: 'Gamma', icon: null, commitSyncEnabled: false },
  ]);
});

test('setCommitSyncEnabledProjects: включает список, выключает остальных, сбрасывает last_run_on у новых', async () => {
  const captured: InsertValues[] = [];
  const db = fakeDb({
    // Один select — текущее состояние проектов пространства (id + текущий enabled из left join).
    selectRows: [
      { id: 'p1', enabled: true }, // включён и остаётся → без сброса last_run_on
      { id: 'p2', enabled: false }, // OFF→ON → сброс last_run_on
      { id: 'p3', enabled: null }, // строки не было, ON → сброс last_run_on
      { id: 'p4', enabled: true }, // ON→OFF → выключаем
    ],
    onInsertValues: (v) => captured.push(v as InsertValues),
  }) as unknown as Database;
  const repo = new DrizzleAutomationRepository(db);

  const affected = await repo.setCommitSyncEnabledProjects('w1', ['p1', 'p2', 'p3']);

  assert.equal(affected, 4);
  const byId = new Map(captured.map((v) => [v.projectId, v]));

  // p1 остаётся включённым — last_run_on НЕ сбрасываем (не было перехода OFF→ON).
  assert.equal(byId.get('p1')?.commitSyncEnabled, true);
  assert.equal('commitSyncLastRunOn' in (byId.get('p1') ?? {}), false);

  // p2 и p3 переходят в ON — last_run_on сбрасывается, чтобы сверка запустилась.
  assert.equal(byId.get('p2')?.commitSyncEnabled, true);
  assert.equal(byId.get('p2')?.commitSyncLastRunOn, null);
  assert.equal(byId.get('p3')?.commitSyncEnabled, true);
  assert.equal(byId.get('p3')?.commitSyncLastRunOn, null);

  // p4 выключается — last_run_on не трогаем.
  assert.equal(byId.get('p4')?.commitSyncEnabled, false);
  assert.equal('commitSyncLastRunOn' in (byId.get('p4') ?? {}), false);
});

test('setCommitSyncEnabledProjects: пустой список выключает все проекты пространства', async () => {
  const captured: InsertValues[] = [];
  const db = fakeDb({
    selectRows: [
      { id: 'p1', enabled: true },
      { id: 'p2', enabled: true },
    ],
    onInsertValues: (v) => captured.push(v as InsertValues),
  }) as unknown as Database;
  const repo = new DrizzleAutomationRepository(db);

  const affected = await repo.setCommitSyncEnabledProjects('w1', []);

  assert.equal(affected, 2);
  assert.ok(captured.every((v) => v.commitSyncEnabled === false));
});
