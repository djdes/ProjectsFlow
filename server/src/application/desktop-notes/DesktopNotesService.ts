import { InsufficientProjectRoleError, ProjectNotFoundError } from '../../domain/project/errors.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { TaskPriority, TaskStatus } from '../../domain/task/Task.js';
import { taskExcerpt } from '../../domain/task/taskExcerpt.js';
import { resolveStatusLabel } from '../../domain/task/statusLabels.js';
import { activeCustomSlots, type KanbanBoardSettings } from '../../domain/kanban/KanbanSettings.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { MoveTask } from '../task/MoveTask.js';
import type { ListTaskComments } from '../task/ListTaskComments.js';
import type { ListTaskAttachments } from '../task/ListTaskAttachments.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
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
  // Колонки доски проекта, в которые задачу можно перенести прямо со стикера.
  readonly statusOptions: ReadonlyArray<{ readonly status: TaskStatus; readonly label: string }>;
  readonly canEdit: boolean;
  readonly deadline: string | null;
  readonly priority: TaskPriority | null;
  readonly path: string;
};

export type DesktopNoteFile = {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
};

// Развёрнутая заметка: всё, что нужно прочитать и ответить, не открывая браузер.
export type DesktopNoteDetail = {
  readonly note: DesktopNote;
  readonly description: string;
  readonly assigneeName: string | null;
  readonly startDate: string | null;
  readonly attachments: DesktopNoteFile[];
  readonly comments: ReadonlyArray<{
    readonly id: string;
    readonly author: string;
    readonly isAgent: boolean;
    readonly body: string;
    readonly createdAt: Date;
    readonly attachments: DesktopNoteFile[];
  }>;
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

export class DesktopNoteStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesktopNoteStatusError';
  }
}

type Deps = {
  readonly repo: DesktopNoteRepository;
  readonly tasks: TaskRepository;
  readonly getTask: GetTask;
  readonly projects?: Pick<ProjectRepository, 'getKanbanSettings'>;
  readonly moveTask?: MoveTask;
  readonly listComments?: ListTaskComments;
  readonly listAttachments?: ListTaskAttachments;
  readonly users?: Pick<UserRepository, 'getManyByIds'>;
  // Те же оповещения, что у переноса задачи в интерфейсе: доска и колокольчик обновятся.
  readonly notify?: {
    readonly taskChanged: (projectId: string, extraUserIds?: readonly string[]) => void;
    readonly statusChanged: (projectId: string, taskId: string, oldStatus: string, newStatus: string, actorUserId: string) => void;
  };
};

const file = (a: TaskAttachment): DesktopNoteFile => ({
  id: a.id,
  filename: a.filename,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
});

// Текст для чтения: без HTML редактора, с переносами строк и markdown-разметкой строк.
const readable = (text: string | null | undefined): string => taskExcerpt(text, 50000);

const BUILT_IN: readonly TaskStatus[] = ['backlog', 'manual', 'todo', 'done'];

// Колонки как на доске: встроенные (кроме скрытых), затем кастомные, «Готово» — последней.
function statusOptions(settings: KanbanBoardSettings | null, current: TaskStatus): DesktopNote['statusOptions'] {
  const builtIn = BUILT_IN.filter(
    (s) => s === current || !settings?.[s as keyof KanbanBoardSettings]?.hidden,
  );
  const order: TaskStatus[] = [
    ...builtIn.filter((s) => s !== 'done'),
    ...activeCustomSlots(settings),
    ...builtIn.filter((s) => s === 'done'),
  ];
  return order.map((status) => ({ status, label: resolveStatusLabel(settings, status) }));
}

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

  // Смена колонки со стикера — тот же перенос, что на доске.
  // restore — снять «Готово»: задача вернётся в колонку, где была до выполнения.
  async setStatus(userId: string, taskId: string, status: TaskStatus, restore = false): Promise<DesktopNote> {
    const note = await this.read(userId, taskId);
    if (!note) throw new TaskNotFoundError(taskId);
    if (!this.deps.moveTask) throw new DesktopNoteStatusError('Смена статуса недоступна');
    if (!note.canEdit) throw new DesktopNoteStatusError('У вас нет прав менять эту задачу');
    if (!note.statusOptions.some((o) => o.status === status)) {
      throw new DesktopNoteStatusError('Такой колонки нет на доске проекта');
    }
    if (status === note.status && !restore) return note;
    const moved = await this.deps.moveTask.execute({
      projectId: note.projectId,
      ownerUserId: userId,
      taskId,
      targetStatus: status,
      beforeTaskId: null,
      afterTaskId: null,
      restore: restore && note.status === 'done',
    });
    this.deps.notify?.taskChanged(note.projectId, [moved.assignee.userId]);
    if (moved.status !== note.status) {
      this.deps.notify?.statusChanged(note.projectId, taskId, note.status, moved.status, userId);
    }
    return (await this.read(userId, taskId)) ?? note;
  }

  async detail(userId: string, taskId: string): Promise<DesktopNoteDetail> {
    const note = await this.read(userId, taskId);
    if (!note) throw new TaskNotFoundError(taskId);
    const task = await this.deps.getTask.execute(note.projectId, userId, taskId);
    const [comments, attachments] = await Promise.all([
      this.deps.listComments?.execute(note.projectId, userId, taskId) ?? Promise.resolve([]),
      this.deps.listAttachments?.execute(note.projectId, userId, taskId) ?? Promise.resolve([]),
    ]);
    const authorIds = [...new Set(comments.filter((c) => c.actorKind === 'user').map((c) => c.ownerUserId))];
    const users = authorIds.length > 0 && this.deps.users ? await this.deps.users.getManyByIds(authorIds) : [];
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    return {
      note,
      description: readable(task.description),
      assigneeName: task.assignee?.displayName ?? null,
      startDate: task.startDate,
      attachments: attachments.filter((a) => !a.commentId).map(file),
      comments: comments.map((c) => ({
        id: c.id,
        author:
          c.actorKind === 'user'
            ? (names.get(c.ownerUserId) ?? 'Участник')
            : (c.agentName ?? (c.actorKind === 'system' ? 'ProjectsFlow' : 'Агент')),
        isAgent: c.actorKind !== 'user',
        body: readable(c.body),
        createdAt: c.createdAt,
        attachments: (c.attachments ?? []).map(file),
      })),
    };
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
      const settings = (await this.deps.projects?.getKanbanSettings(task.projectId)) ?? null;
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
        statusLabel: resolveStatusLabel(settings, task.status),
        statusOptions: statusOptions(settings, task.status),
        canEdit: task.canEdit,
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
