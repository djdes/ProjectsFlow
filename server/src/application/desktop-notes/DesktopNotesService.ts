import { InsufficientProjectRoleError, ProjectNotFoundError } from '../../domain/project/errors.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { TaskPriority, TaskStatus } from '../../domain/task/Task.js';
import { taskExcerpt } from '../../domain/task/taskExcerpt.js';
import { STATUS_LABEL } from '../../domain/task/statusLabels.js';
import type { GetTask } from '../task/GetTask.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { DesktopNoteRepository } from './DesktopNoteRepository.js';

// Стикер задачи для приложения «ProjectsFlow Заметки» (и список закреплённого в интерфейсе).
export type DesktopNote = {
  readonly taskId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly title: string;
  readonly excerpt: string;
  readonly status: TaskStatus;
  readonly statusLabel: string;
  readonly deadline: string | null;
  readonly priority: TaskPriority | null;
  readonly path: string;
};

export type DesktopNotesView = {
  readonly notes: DesktopNote[];
  // null — приложение ни разу не подключалось.
  readonly appLastSeenAt: Date | null;
};

export class DesktopNotePinLimitError extends Error {
  constructor(readonly limit: number) {
    super(`На экран можно закрепить не больше ${limit} задач`);
    this.name = 'DesktopNotePinLimitError';
  }
}

export const DESKTOP_NOTE_PIN_LIMIT = 30;

type Deps = {
  readonly repo: DesktopNoteRepository;
  readonly tasks: TaskRepository;
  readonly getTask: GetTask;
};

const isAccessLoss = (e: unknown): boolean =>
  e instanceof TaskNotFoundError || e instanceof ProjectNotFoundError || e instanceof InsufficientProjectRoleError;

// Markdown первой строки (заголовок `#`, жирный, код) стикеру не нужен — только текст.
function plain(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/u, '')
    .replace(/(\*\*|__|~~|`)/gu, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .trim();
}

export class DesktopNotesService {
  constructor(private readonly deps: Deps) {}

  async list(userId: string): Promise<DesktopNotesView> {
    const [ids, app] = await Promise.all([
      this.deps.repo.listPinnedTaskIds(userId),
      this.deps.repo.getApp(userId),
    ]);
    const notes: DesktopNote[] = [];
    for (const taskId of ids) {
      const note = await this.read(userId, taskId);
      // Задачу удалили или доступ к проекту пропал — стикер больше не нужен.
      if (note) notes.push(note);
      else await this.deps.repo.unpin(userId, taskId);
    }
    return { notes, appLastSeenAt: app?.lastSeenAt ?? null };
  }

  async pin(userId: string, taskId: string): Promise<DesktopNote> {
    const note = await this.read(userId, taskId);
    if (!note) throw new TaskNotFoundError(taskId);
    const pinned = await this.deps.repo.listPinnedTaskIds(userId);
    if (!pinned.includes(taskId) && pinned.length >= DESKTOP_NOTE_PIN_LIMIT) {
      throw new DesktopNotePinLimitError(DESKTOP_NOTE_PIN_LIMIT);
    }
    await this.deps.repo.pin(userId, taskId);
    return note;
  }

  unpin(userId: string, taskId: string): Promise<void> {
    return this.deps.repo.unpin(userId, taskId);
  }

  // Приложение отмечается при каждом опросе — интерфейс знает, установлено ли оно.
  heartbeat(userId: string, appVersion: string | null): Promise<void> {
    return this.deps.repo.touchApp(userId, appVersion);
  }

  private async read(userId: string, taskId: string): Promise<DesktopNote | null> {
    const raw = await this.deps.tasks.getById(taskId);
    if (!raw) return null;
    try {
      const task = await this.deps.getTask.execute(raw.projectId, userId, taskId);
      const lines = taskExcerpt(task.description, 600)
        .split('\n')
        .map(plain)
        .filter((l) => l.length > 0);
      return {
        taskId: task.id,
        projectId: task.projectId,
        projectName: task.context.isInbox ? 'Личные' : task.context.projectName,
        title: (lines[0] ?? 'Без названия').slice(0, 160),
        excerpt: lines.slice(1).join(' ').slice(0, 220),
        status: task.status,
        statusLabel: STATUS_LABEL[task.status],
        deadline: task.deadline,
        priority: task.priority,
        path: `/projects/${task.projectId}/tasks/${task.id}`,
      };
    } catch (e) {
      if (isAccessLoss(e)) return null;
      throw e;
    }
  }
}
