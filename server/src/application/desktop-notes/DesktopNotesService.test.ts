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

type Options = {
  readonly settings?: Record<string, unknown>;
  readonly workerEnabled?: boolean;
};

function service(repo: FakeRepo, noAccess: Set<string> = new Set(), moves: string[] = [], options: Options = {}) {
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
        status: id.startsWith('done') ? 'done' : 'manual',
        canEdit: !id.startsWith('ro'),
        deadline: '2026-11-20',
        priority: null,
        context: { projectName: 'Wesetup', isInbox: false },
      };
    },
  } as unknown as GetTask;
  const settings = options.settings ?? { manual: { label: 'Делаю' }, todo: { hidden: true }, custom_1: { label: 'Тест' } };
  const projects = { getKanbanSettings: async () => settings };
  const moveTask = {
    execute: async (c: { taskId: string; targetStatus: string; restore?: boolean }) => {
      moves.push(`${c.taskId}->${c.targetStatus}${c.restore ? ' (restore)' : ''}`);
      return { id: c.taskId, status: c.restore ? 'manual' : c.targetStatus, assignee: { userId: 'u1' } };
    },
  } as unknown as MoveTask;
  const workerPolicy = { isEnabledForProject: async () => options.workerEnabled ?? true };
  return new DesktopNotesService({ repo, tasks, getTask, projects, moveTask, workerPolicy });
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

test('выключенный воркер: колонки «Воркер» нет в стикере и перенос в неё отклоняется', async () => {
  const moves: string[] = [];
  const s = service(new FakeRepo(), new Set(), moves, { settings: {}, workerEnabled: false });
  const note = await s.pin('u1', 't1');
  assert.ok(!note.statusOptions.some((o) => o.status === 'todo'));
  await assert.rejects(s.setStatus('u1', 't1', 'todo'), DesktopNoteStatusError);
  assert.deepEqual(moves, []);
  const enabled = await service(new FakeRepo(), new Set(), [], { settings: {} }).pin('u1', 't1');
  assert.ok(enabled.statusOptions.some((o) => o.status === 'todo'));
});

test('снять «Готово» со стикера можно и при скрытой колонке «В работе»', async () => {
  const moves: string[] = [];
  const s = service(new FakeRepo(), new Set(), moves, { settings: { manual: { hidden: true } } });
  const before = await s.pin('u1', 'done-1');
  assert.ok(!before.statusOptions.some((o) => o.status === 'manual'));
  await s.setStatus('u1', 'done-1', 'manual', true);
  assert.deepEqual(moves, ['done-1->manual (restore)']);
});

test('устаревший стикер: снятие «Готово» у невыполненной задачи ничего не двигает', async () => {
  const moves: string[] = [];
  const s = service(new FakeRepo(), new Set(), moves);
  const note = await s.setStatus('u1', 't1', 'manual', true);
  assert.equal(note.status, 'manual');
  assert.deepEqual(moves, []);
});
