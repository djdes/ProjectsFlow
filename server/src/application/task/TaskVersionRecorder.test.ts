import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Task } from '../../domain/task/Task.js';
import type { TaskVersion } from '../../domain/task/TaskVersion.js';
import { TaskVersionRecorder } from './TaskVersionRecorder.js';
import type {
  CreateTaskVersionInput,
  TaskVersionRepository,
} from './TaskVersionRepository.js';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    createdBy: 'creator-1',
    creator: null,
    assignee: { userId: 'user-1', displayName: 'Олег', avatarUrl: null },
    description: 'Первая версия',
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'todo',
    statusBeforeDone: null,
    position: 1024,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    createdAt: new Date('2026-07-14T10:00:00.000Z'),
    updatedAt: new Date('2026-07-14T10:00:00.000Z'),
    ...overrides,
  };
}

function harness(): {
  readonly recorder: TaskVersionRecorder;
  readonly created: CreateTaskVersionInput[];
} {
  const created: CreateTaskVersionInput[] = [];
  const versions: TaskVersionRepository = {
    async create(input) {
      created.push(input);
    },
    async listForTask(): Promise<TaskVersion[]> {
      return [];
    },
    async getById(): Promise<TaskVersion | null> {
      return null;
    },
    async taskIdsWithVersions(): Promise<Set<string>> {
      return new Set();
    },
  };
  let sequence = 0;
  return {
    recorder: new TaskVersionRecorder({
      versions,
      idGen: () => `version-${++sequence}`,
    }),
    created,
  };
}

test('records creation, exact changed fields, actor and expanded snapshot', async () => {
  const { recorder, created } = harness();
  const before = task();
  const after = task({
    assignee: { userId: 'user-2', displayName: 'Денис', avatarUrl: '/denis.png' },
    description: 'Обновлённое описание',
    status: 'in_progress',
    deadline: '2026-07-30',
    startDate: '2026-07-20',
    priority: 1,
  });

  await recorder.record(before, 'creator-1');
  await recorder.record(after, 'editor-1', before);

  assert.equal(created.length, 2);
  assert.deepEqual(created[0]!.changedFields, ['created']);
  assert.equal(created[1]!.actorUserId, 'editor-1');
  assert.deepEqual(created[1]!.changedFields, [
    'description',
    'assignee',
    'status',
    'deadline',
    'priority',
  ]);
  assert.equal(created[1]!.snapshot.assignee.displayName, 'Денис');
  assert.equal(created[1]!.snapshot.startDate, '2026-07-20');
});

test('skips no-op updates but records explicit related changes', async () => {
  const { recorder, created } = harness();
  const current = task();

  await recorder.record(current, 'user-1', current);
  await recorder.record(current, 'user-1', current, ['files']);

  assert.equal(created.length, 1);
  assert.deepEqual(created[0]!.changedFields, ['files']);
});
