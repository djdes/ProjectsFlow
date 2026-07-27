import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import { GetAgentTask } from './GetAgentTask.js';

// pf_get_task — то, чем агент «смотрит» задачу. Здесь фиксируем два свойства, без которых
// приложенные файлы для него невидимы: в выдачу попадают ВСЕ вложения (включая файлы из
// комментариев), а гигантские файлы не рвут ответ, а приезжают без байтов.

const PROJECT_ID = 'project-1';
const TASK_ID = 'task-1';
const USER_ID = 'user-1';

function attachment(id: string, commentId: string | null, sizeBytes: number): TaskAttachment {
  return {
    id,
    taskId: TASK_ID,
    commentId,
    filename: `${id}.png`,
    mimeType: 'image/png',
    sizeBytes,
    storageKey: `${id}.bin`,
    uploadedAt: new Date('2026-07-15T10:00:00Z'),
  };
}

function makeUseCase(items: TaskAttachment[]): GetAgentTask {
  return new GetAgentTask({
    projects: {
      async getById() {
        return { id: PROJECT_ID } as never;
      },
    } as never,
    members: {
      async findForProject() {
        return { projectId: PROJECT_ID, userId: USER_ID, role: 'owner', joinedAt: new Date() };
      },
    } as never,
    tasks: {
      async getById() {
        return { id: TASK_ID, projectId: PROJECT_ID } as never;
      },
    } as never,
    attachments: {
      async listAllByTask() {
        return items;
      },
      async listByTask() {
        throw new Error('agent must see comment attachments too — use listAllByTask');
      },
    } as never,
    comments: {
      async listByTask() {
        return [];
      },
    } as never,
    storage: {
      async read(storageKey: string) {
        const item = items.find((a) => a.storageKey === storageKey);
        return item ? { data: Buffer.alloc(item.sizeBytes, 1), mimeType: item.mimeType } : null;
      },
    } as never,
  });
}

test('agent sees files attached to comments, not only to the task itself', async () => {
  const useCase = makeUseCase([attachment('att-task', null, 10), attachment('att-comment', 'c-1', 10)]);

  const { attachments } = await useCase.execute(PROJECT_ID, USER_ID, TASK_ID);

  assert.deepEqual(
    attachments.map((a) => [a.id, a.commentId, a.data?.byteLength ?? null]),
    [
      ['att-task', null, 10],
      ['att-comment', 'c-1', 10],
    ],
  );
});

test('attachments beyond the response budget come back as metadata without bytes', async () => {
  const huge = 20 * 1024 * 1024;
  const useCase = makeUseCase([
    attachment('att-1', null, huge),
    attachment('att-2', null, huge),
    attachment('att-3', null, 128),
  ]);

  const { attachments } = await useCase.execute(PROJECT_ID, USER_ID, TASK_ID);

  // Первый влезает в бюджет (24 MB), второй — уже нет и приезжает без байтов, но
  // метаданные у него есть: агент знает, что файл существует и качается поштучно.
  // Третий, маленький, снова влезает — пропуск одного тяжёлого файла не отрезает хвост.
  assert.equal(attachments.length, 3);
  assert.equal(attachments[0]?.data?.byteLength, huge);
  assert.equal(attachments[1]?.data, null);
  assert.equal(attachments[2]?.data?.byteLength, 128);
});
