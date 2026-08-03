import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerPolicy } from './WorkerPolicy.js';
import { WorkerDisabledError } from '../../domain/workspace/errors.js';

function makePolicy(seed: {
  workspaceIdByProject?: Record<string, string | null>;
  workerEnabledByWorkspace?: Record<string, boolean>;
}): WorkerPolicy {
  return new WorkerPolicy({
    projects: {
      async getWorkspaceId(projectId) {
        return seed.workspaceIdByProject?.[projectId] ?? null;
      },
    },
    workspaces: {
      async getById(id) {
        const enabled = seed.workerEnabledByWorkspace?.[id];
        return enabled === undefined ? null : { workerEnabled: enabled };
      },
    },
  });
}

test('воркер включён в пространстве проекта — политика пропускает', async () => {
  const policy = makePolicy({
    workspaceIdByProject: { p1: 'w1' },
    workerEnabledByWorkspace: { w1: true },
  });
  assert.equal(await policy.isEnabledForProject('p1'), true);
  await policy.requireEnabledForProject('p1'); // не бросает
});

test('воркер выключен — политика бросает WorkerDisabledError', async () => {
  const policy = makePolicy({
    workspaceIdByProject: { p1: 'w1' },
    workerEnabledByWorkspace: { w1: false },
  });
  assert.equal(await policy.isEnabledForProject('p1'), false);
  await assert.rejects(() => policy.requireEnabledForProject('p1'), WorkerDisabledError);
});

test('пространство проекта не найдено — считаем воркер доступным', async () => {
  // Состояние «данных нет» не должно превращаться в запрет: иначе кривая строка в БД
  // молча отключала бы работу всей команде.
  const policy = makePolicy({ workspaceIdByProject: { p1: null } });
  assert.equal(await policy.isEnabledForProject('p1'), true);

  const orphan = makePolicy({ workspaceIdByProject: { p1: 'ghost' } });
  assert.equal(await orphan.isEnabledForProject('p1'), true);
});
