import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetProjectActivity } from './GetProjectActivity.js';
import type { ActivityEvent } from '../../domain/activity/ActivityEvent.js';

const PROJECT = 'p1';
const ME = 'u1';

function ev(id: string, taskId: string): ActivityEvent {
  return {
    id,
    workspaceId: 'w1',
    projectId: PROJECT,
    actorUserId: ME,
    kind: 'task_updated',
    payload: { taskId, taskExcerpt: 'Задача' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

// deletedIds — задачи в корзине; репозиторий отдаёт ровно контракт findDeletedTaskIds
// (всё, чего нет среди живых).
function makeUseCase(events: ActivityEvent[], deletedIds: string[]) {
  return new GetProjectActivity({
    projects: {
      async getById(id: string) {
        return { id, ownerId: ME, createdAt: new Date('2025-12-01T00:00:00Z') };
      },
    } as never,
    members: {
      async findForProject(_p: string, userId: string) {
        return userId === ME ? { role: 'owner' } : null;
      },
    } as never,
    activity: {
      async listForProject() {
        return events;
      },
    } as never,
    users: {
      async getManyByIds() {
        return [];
      },
    } as never,
    taskVersions: {
      async getLatestForProject() {
        return null;
      },
      async taskIdsWithVersions() {
        return new Set<string>();
      },
    } as never,
    tasks: {
      async findDeletedTaskIds(ids: readonly string[]) {
        return new Set(ids.filter((id) => deletedIds.includes(id)));
      },
    } as never,
  });
}

test('событие удалённой задачи остаётся в ленте, но помечено taskDeleted', async () => {
  const useCase = makeUseCase([ev('e1', 't-alive'), ev('e2', 't-trashed')], ['t-trashed']);

  const result = await useCase.execute(PROJECT, ME, { limit: 20 });

  assert.equal(result.items.length, 2, 'лог-записи не вычищаются при удалении задачи');
  assert.equal(result.items[0]!.taskDeleted, false);
  assert.equal(result.items[1]!.taskDeleted, true);
  assert.equal(
    result.items[1]!.payload?.taskExcerpt,
    'Задача',
    'денормализованный текст «что было» сохраняется',
  );
});

test('события без taskId никогда не помечаются удалёнными', async () => {
  const memberEvent: ActivityEvent = {
    id: 'e3',
    workspaceId: 'w1',
    projectId: PROJECT,
    actorUserId: ME,
    kind: 'member_added',
    payload: { targetUserId: 'u2' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  const useCase = makeUseCase([memberEvent], []);

  const result = await useCase.execute(PROJECT, ME, { limit: 20 });

  assert.equal(result.items[0]!.taskDeleted, false);
});
