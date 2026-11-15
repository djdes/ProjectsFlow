import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';
import type { GetTask } from '../task/GetTask.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { MoveTask } from '../task/MoveTask.js';
import type { DesktopNoteApp, DesktopNoteRepository } from './DesktopNoteRepository.js';
import { DESKTOP_NOTE_PIN_LIMIT, DesktopNotePinLimitError, DesktopNoteStatusError, DesktopNotesService } from './DesktopNotesService.js';

class FakeRepo implements DesktopNoteRepository {
  pins: string[] = [];
  app: DesktopNoteApp | null = null;
  async listPinnedTaskIds(): Promise<string[]> {
    return [...this.pins];
  }
  async pin(_u: string, taskId: string): Promise<void> {
    if (!this.pins.includes(taskId)) this.pins.push(taskId);
  }
  async unpin(_u: string, taskId: string): Promise<void> {
    this.pins = this.pins.filter((p) => p !== taskId);
  }
  async touchApp(): Promise<void> {
    this.app = { lastSeenAt: new Date(), appVersion: '1.0.0' };
  }
  async getApp(): Promise<DesktopNoteApp | null> {
    return this.app;
  }
}

function service(repo: FakeRepo, noAccess: Set<string> = new Set(), moves: string[] = []) {
  const tasks = {
    getById: async (id: string) => (id.startsWith('gone') ? null : { id, projectId: 'p1' }),
  } as unknown as TaskRepository;
  const getTask = {
    execute: async (_p: string, _u: string, id: string) => {
      if (noAccess.has(id)) throw new InsufficientProjectRoleError('read_project');
      return {
        id,
        projectId: 'p1',
        description: `## **Сделать** ${id}\nПодробности задачи`,
        status: 'manual',
        canEdit: !id.startsWith('ro'),
        deadline: '2026-11-20',
        priority: null,
        context: { projectName: 'Wesetup', isInbox: false },
      };
    },
  } as unknown as GetTask;
  const projects = { getKanbanSettings: async () => ({ manual: { label: 'Делаю' }, todo: { hidden: true }, custom_1: { label: 'Тест' } }) };
  const moveTask = {
    execute: async (c: { taskId: string; targetStatus: string }) => {
      moves.push(`${c.taskId}->${c.targetStatus}`);
      return { id: c.taskId, status: c.targetStatus, assignee: { userId: 'u1' } };
    },
  } as unknown as MoveTask;
  return new DesktopNotesService({ repo, tasks, getTask, projects, moveTask });
}

test('стикер: заголовок без markdown, описание отдельно, подпись статуса и ссылка', async () => {
  const repo = new FakeRepo();
  const note = await service(repo).pin('u1', 't1');
  assert.equal(note.title, 'Сделать t1');
  assert.equal(note.excerpt, 'Подробности задачи');
  assert.equal(note.statusLabel, 'Делаю');
  assert.deepEqual(note.statusOptions.map((o) => o.label), ['Черновики', 'Делаю', 'Тест', 'Готово']);
  assert.equal(note.path, '/projects/p1/tasks/t1');
  assert.deepEqual(repo.pins, ['t1']);
});

test('удалённые задачи и задачи без доступа снимаются с экрана при чтении', async () => {
  const repo = new FakeRepo();
  repo.pins = ['t1', 'gone-1', 't2'];
  const view = await service(repo, new Set(['t2'])).list('u1');
  assert.deepEqual(view.notes.map((n) => n.taskId), ['t1']);
  assert.deepEqual(repo.pins, ['t1']);
  assert.equal(view.appLastSeenAt, null);
});

test('нельзя закрепить больше лимита, повторное закрепление не считается', async () => {
  const repo = new FakeRepo();
  repo.pins = Array.from({ length: DESKTOP_NOTE_PIN_LIMIT }, (_, i) => `t${i}`);
  const s = service(repo);
  await assert.rejects(s.pin('u1', 'extra'), DesktopNotePinLimitError);
  await s.pin('u1', 't0');
  assert.equal(repo.pins.length, DESKTOP_NOTE_PIN_LIMIT);
});

test('статус со стикера: только колонки доски и только с правом правки', async () => {
  const moves: string[] = [];
  const s = service(new FakeRepo(), new Set(), moves);
  await s.setStatus('u1', 't1', 'done');
  assert.deepEqual(moves, ['t1->done']);
  await assert.rejects(s.setStatus('u1', 't1', 'todo'), DesktopNoteStatusError);
  await assert.rejects(s.setStatus('u1', 'ro-1', 'done'), DesktopNoteStatusError);
});
