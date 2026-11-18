import assert from 'node:assert/strict';
import test from 'node:test';
import type { Task } from '../../domain/task/Task.js';
import { changedTaskFields, snapshotOfTask } from '../../domain/task/TaskVersion.js';
import {
  parseRunModeCallback,
  runModeKeyboard,
} from '../../application/telegram/composer/TelegramComposerService.js';
import { toDto } from './routes.js';
import { createTaskSchema, updateTaskSchema } from './schemas.js';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    createdBy: 'u1',
    creator: { userId: 'u1', displayName: 'U', avatarUrl: null },
    assignee: { userId: 'u1', displayName: 'U', avatarUrl: null },
    description: 'Задача',
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'todo',
    statusBeforeDone: null,
    position: 1024,
    ralphMode: 'normal',
    runMode: 'quick',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    createdAt: new Date('2026-11-18T10:00:00.000Z'),
    updatedAt: new Date('2026-11-18T10:00:00.000Z'),
    ...overrides,
  } as Task;
}

test('runMode: create/update принимают quick|full и отвергают прочее', () => {
  assert.equal(createTaskSchema.parse({ description: 'x', runMode: 'full' }).runMode, 'full');
  assert.equal(createTaskSchema.parse({ description: 'x' }).runMode, undefined);
  assert.equal(updateTaskSchema.parse({ runMode: 'quick' }).runMode, 'quick');
  assert.throws(() => createTaskSchema.parse({ description: 'x', runMode: 'turbo' }));
  assert.throws(() => updateTaskSchema.parse({ runMode: 'normal' }));
});

test('runMode: DTO задачи отдаёт поле как есть', () => {
  assert.equal(toDto(task({ runMode: 'full' })).runMode, 'full');
  assert.equal(toDto(task()).runMode, 'quick');
});

test('runMode: смена режима попадает в версии, старые снимки без поля — нет', () => {
  const prev = snapshotOfTask(task());
  assert.deepEqual(changedTaskFields(prev, snapshotOfTask(task({ runMode: 'full' }))), ['runMode']);
  const { runMode: _legacy, ...legacy } = prev;
  assert.deepEqual(changedTaskFields(legacy, snapshotOfTask(task({ runMode: 'full' }))), []);
});

test('runMode: telegram callback rm:<uuid>:<q|f>', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.deepEqual(parseRunModeCallback(`rm:${id}:f`), { taskId: id, runMode: 'full' });
  assert.deepEqual(parseRunModeCallback(`rm:${id}:q`), { taskId: id, runMode: 'quick' });
  assert.equal(parseRunModeCallback(`rm:${id}:x`), null);
  assert.equal(parseRunModeCallback('rm:not-a-uuid:f'), null);
  assert.equal(parseRunModeCallback(`tc:${id}`), null);
  const buttons = runModeKeyboard(id).inline_keyboard.flat();
  assert.deepEqual(buttons.map((b) => b.callback_data), [`rm:${id}:q`, `rm:${id}:f`]);
  for (const b of buttons) assert.ok(Buffer.byteLength(b.callback_data ?? '') <= 64);
});
