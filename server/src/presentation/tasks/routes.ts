import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { ListTasks, TaskWithCounts } from '../../application/task/ListTasks.js';
import type { CreateTask } from '../../application/task/CreateTask.js';
import type { UpdateTask } from '../../application/task/UpdateTask.js';
import type { GetTaskVersions } from '../../application/task/GetTaskVersions.js';
import type { GetProjectTaskVersions } from '../../application/task/GetProjectTaskVersions.js';
import type { RestoreTaskVersion } from '../../application/task/RestoreTaskVersion.js';
import type { MoveTask } from '../../application/task/MoveTask.js';
import type { DeleteTask } from '../../application/task/DeleteTask.js';
import type { ListTrashedTasks } from '../../application/task/ListTrashedTasks.js';
import type { RestoreDeletedTask } from '../../application/task/RestoreDeletedTask.js';
import type { PurgeDeletedTask } from '../../application/task/PurgeDeletedTask.js';
import type { LinkCommit } from '../../application/task/LinkCommit.js';
import type { UnlinkCommit } from '../../application/task/UnlinkCommit.js';
import type { ListTaskCommits } from '../../application/task/ListTaskCommits.js';
import type { SyncTaskCommits } from '../../application/task/SyncTaskCommits.js';
import type { UploadTaskAttachment } from '../../application/task/UploadTaskAttachment.js';
import type { DeleteTaskAttachment } from '../../application/task/DeleteTaskAttachment.js';
import type { ListTaskAttachments } from '../../application/task/ListTaskAttachments.js';
import type { ListTaskComments } from '../../application/task/ListTaskComments.js';
import type { CreateTaskComment } from '../../application/task/CreateTaskComment.js';
import type { UpdateTaskComment } from '../../application/task/UpdateTaskComment.js';
import type { DeleteTaskComment } from '../../application/task/DeleteTaskComment.js';
import type { RequestRalphCancel } from '../../application/task/RequestRalphCancel.js';
import type { RevokeRalphCancel } from '../../application/task/RevokeRalphCancel.js';
import type { MoveTaskToProject } from '../../application/task/MoveTaskToProject.js';
import type { ChangeTaskAssignee } from '../../application/task/ChangeTaskAssignee.js';
import type { ExportTasksDigest } from '../../application/task/ExportTasksDigest.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { TaskVersion } from '../../domain/task/TaskVersion.js';
import { requireAuth } from '../middleware/requireAuth.js';
import type { ProjectNotificationService } from '../../application/notifications/ProjectNotificationService.js';
import type { DispatchCommentNotifications } from '../../application/notifications/DispatchCommentNotifications.js';
import type { GetCommentNotifications } from '../../application/task/GetCommentNotifications.js';
import type { TaskRepository } from '../../application/task/TaskRepository.js';
import type { MaybeReopenForClarification } from '../../application/task/MaybeReopenForClarification.js';
import type { BroadcastTelegramNotificationByTask } from '../../application/telegram/BroadcastTelegramNotificationByTask.js';
import { markdownToTelegramHtml } from '../../application/telegram/telegramMarkdown.js';
import type { ProjectRepository } from '../../application/project/ProjectRepository.js';
import {
  assignToProjectSchema,
  changeTaskAssigneeSchema,
  createTaskCommentSchema,
  createTaskSchema,
  exportDigestSchema,
  linkCommitSchema,
  moveTaskSchema,
  updateTaskCommentSchema,
  updateTaskSchema,
} from './schemas.js';

type Deps = {
  readonly listTasks: ListTasks;
  readonly createTask: CreateTask;
  readonly updateTask: UpdateTask;
  readonly moveTask: MoveTask;
  readonly deleteTask: DeleteTask;
  // Корзина проекта + откат удаления (db/134).
  readonly listTrashedTasks: ListTrashedTasks;
  readonly restoreDeletedTask: RestoreDeletedTask;
  readonly purgeDeletedTask: PurgeDeletedTask;
  readonly getTaskVersions: GetTaskVersions;
  readonly getProjectTaskVersions: GetProjectTaskVersions;
  readonly restoreTaskVersion: RestoreTaskVersion;
  readonly linkCommit: LinkCommit;
  readonly unlinkCommit: UnlinkCommit;
  readonly listTaskCommits: ListTaskCommits;
  readonly syncTaskCommits: SyncTaskCommits;
  readonly uploadAttachment: UploadTaskAttachment;
  readonly deleteAttachment: DeleteTaskAttachment;
  readonly listAttachments: ListTaskAttachments;
  readonly listComments: ListTaskComments;
  readonly createComment: CreateTaskComment;
  readonly updateComment: UpdateTaskComment;
  readonly deleteComment: DeleteTaskComment;
  readonly requestRalphCancel: RequestRalphCancel;
  readonly revokeRalphCancel: RevokeRalphCancel;
  readonly assignToProject: MoveTaskToProject;
  readonly changeAssignee: ChangeTaskAssignee;
  // Экспорт выбранных задач в дайджест (буфер/email/Telegram).
  readonly exportDigest: ExportTasksDigest;
  readonly maxAttachmentBytes: number;
  // Live-обновление: сигнал «в проекте изменились задачи» всем участникам (SSE).
  // Best-effort, не блокирует ответ.
  readonly notifyTaskChanged: (projectId: string) => void;
  // SSE comment_added — для realtime-реакции диспетчера/UI на новый комментарий.
  // actorKind/agentName опциональны — для Claude-стилизации agent-комментов в UI.
  readonly notifyCommentAdded: (
    projectId: string,
    taskId: string,
    commentId: string,
    ownerUserId: string,
    actorKind?: 'user' | 'agent' | 'system',
    agentName?: string | null,
  ) => void;
  // SSE task_status_changed — move + авто-возврат awaiting_clarification → in_progress.
  readonly notifyStatusChanged: (
    projectId: string,
    taskId: string,
    oldStatus: string,
    newStatus: string,
    actorUserId: string,
  ) => void;
  // Чтение задачи (для oldStatus до move).
  readonly tasks: TaskRepository;
  // Авто-возврат awaiting_clarification → in_progress по ralph-маркеру в комменте.
  readonly maybeReopenForClarification: MaybeReopenForClarification;
  // Email-оповещения команде (источник 'team' — действия человека). Fire-and-forget.
  readonly notifier: ProjectNotificationService;
  // Telegram-рассылка всем участникам проекта по taskId. Fire-and-forget.
  readonly broadcastTelegram: BroadcastTelegramNotificationByTask;
  // Оркестратор уведомлений по комментарию: email+TG адресно + журнал доставки.
  readonly dispatchCommentNotifications: DispatchCommentNotifications;
  // Чтение журнала «кто уведомлён» для меню ⋮ у комментария.
  readonly getCommentNotifications: GetCommentNotifications;
  // Для получения имени проекта в TG-сообщениях.
  readonly projectRepo: ProjectRepository;
};

type TaskDto = Omit<
  Task,
  'createdBy' | 'createdAt' | 'updatedAt' | 'ralphCancelRequestedAt'
> & {
  createdAt: string;
  updatedAt: string;
  // Сериализуем как ISO-string чтоб клиент парсил через Date(...). null если нет запроса.
  ralphCancelRequestedAt: string | null;
  commitCount?: number;
  attachmentCount?: number;
  commentCount?: number;
};

export function toDto(t: Task | TaskWithCounts): TaskDto {
  // Сырой createdBy остаётся серверным audit-id. Клиент получает отдельный creator
  // только для отображения рядом с датой создания; назначение живёт исключительно в assignee.
  const { createdBy: _serverOnlyCreatedBy, ...publicTask } = t;
  const base: TaskDto = {
    ...publicTask,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    ralphCancelRequestedAt: t.ralphCancelRequestedAt
      ? t.ralphCancelRequestedAt.toISOString()
      : null,
  };
  if ('commitCount' in t) base.commitCount = t.commitCount;
  if ('attachmentCount' in t) base.attachmentCount = t.attachmentCount;
  if ('commentCount' in t) base.commentCount = t.commentCount;
  return base;
}

function versionToDto(v: TaskVersion) {
  return {
    id: v.id,
    taskId: v.taskId,
    actorUserId: v.actorUserId,
    actor: v.actor,
    changedFields: v.changedFields,
    createdAt: v.createdAt.toISOString(),
    snapshot: v.snapshot,
  };
}

type CommitDto = Omit<TaskCommit, 'committedAt' | 'linkedAt'> & {
  committedAt: string;
  linkedAt: string;
};

function commitToDto(c: TaskCommit): CommitDto {
  return { ...c, committedAt: c.committedAt.toISOString(), linkedAt: c.linkedAt.toISOString() };
}

type AttachmentDto = Omit<TaskAttachment, 'uploadedAt' | 'storageKey'> & {
  uploadedAt: string;
  url: string;
};

type CommentDto = Omit<TaskComment, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
  attachments?: AttachmentDto[];
};

function commentToDto(c: TaskComment & { attachments?: TaskAttachment[] }): CommentDto {
  return {
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    attachments: c.attachments ? c.attachments.map(attachmentToDto) : undefined,
  };
}

function attachmentToDto(att: TaskAttachment): AttachmentDto {
  // storageKey не отдаём наружу — клиент работает только через /api/attachments/:id.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { storageKey: _storageKey, ...rest } = att;
  return {
    ...rest,
    uploadedAt: att.uploadedAt.toISOString(),
    url: `/api/attachments/${att.id}`,
  };
}

// Статус-лейблы для TG-сообщений (совпадают с client-side statusLabels).
const TG_STATUS_LABEL: Record<string, string> = {
  backlog: 'Черновики',
  manual: 'В ручную',
  todo: 'Воркер',
  in_progress: 'В работе',
  awaiting_clarification: 'На уточнении',
  done: 'Готово',
};

function tgExcerpt(text: string | null, limit = 100): string {
  const s = (text ?? '').trim().replace(/\s+/g, ' ');
  return s.length <= limit ? s : s.slice(0, limit - 1).trimEnd() + '…';
}

// Best-effort Telegram broadcast. Ошибки не влияют на HTTP-ответ.
function fireTgBroadcast(
  deps: Pick<Deps, 'broadcastTelegram' | 'projectRepo'>,
  taskId: string,
  projectId: string,
  skipUserId: string,
  buildText: (projectName: string) => string,
  kind: string,
): void {
  void (async () => {
    const project = await deps.projectRepo.getById(projectId);
    const projectName = project?.name ?? 'проект';
    await deps.broadcastTelegram.execute({
      taskId,
      text: buildText(projectName),
      kind,
      parseMode: 'HTML',
      respectPrefs: true,
      skipUserId,
    });
  })().catch((err) => {
    console.warn('[tasks/tg-broadcast] failed:', err);
  });
}

export function tasksRouter(deps: Deps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  // multer memory-storage: small images (max 10MB), хранилище живёт в RAM до момента
  // когда UploadTaskAttachment запишет на диск через AttachmentStorage. Это даёт нам
  // единое место для размер-проверок и MIME-валидации.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxAttachmentBytes },
  });

  // multer декодирует `originalname` из заголовка как latin1 — кириллица (и любые
  // не-ASCII имена) превращаются в мохибейк. Перекодируем обратно latin1 → utf8,
  // чтобы имя файла отображалось корректно.
  const decodeFilename = (raw: string): string => {
    try {
      return Buffer.from(raw, 'latin1').toString('utf8');
    } catch {
      return raw;
    }
  };

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const list = await deps.listTasks.execute(projectId, req.user!.id);
      res.json({ tasks: list.map(toDto) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const body = createTaskSchema.parse(req.body);
      const task = await deps.createTask.execute({
        projectId,
        ownerUserId: req.user!.id,
        description: body.description,
        icon: body.icon ?? null,
        cover: body.cover ?? null,
        coverPosition: body.coverPosition,
        status: body.status ?? 'todo',
        afterTaskId: body.afterTaskId ?? null,
        ralphMode: body.ralphMode,
        assigneeUserId: body.assigneeUserId ?? null,
        deadline: body.deadline ?? null,
        startDate: body.startDate ?? null,
        parentTaskId: body.parentTaskId ?? null,
        priority: body.priority ?? null,
      });
      deps.notifyTaskChanged(projectId);
      void deps.notifier.onTaskCreated(projectId, req.user!.id, task, 'team').catch(() => {});
      fireTgBroadcast(deps, task.id, projectId, req.user!.id, (pn) =>
        `📋 Новая задача в «${pn}»:\n<i>${markdownToTelegramHtml(tgExcerpt(task.description))}</i>`,
        'comment_on_my_task',
      );
      res.status(201).json({ task: toDto(task) });
    } catch (e) {
      next(e);
    }
  });

  // POST /digest — экспорт выбранных задач: text для буфера, отправка на email/в Telegram.
  // Серверный рендер из авторитетных данных; доступ — read_project (внутри ListTasks).
  router.post('/digest', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const body = exportDigestSchema.parse(req.body);
      const result = await deps.exportDigest.execute({
        projectId,
        ownerUserId: req.user!.id,
        taskIds: body.taskIds,
        channel: body.channel,
        recipients: body.recipients ?? [],
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // Общая история всех задач проекта. Этот статический путь должен быть объявлен до
  // параметрических taskId-маршрутов, чтобы `versions` не принимался за id задачи.
  router.get('/versions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deps.getProjectTaskVersions.execute(
        req.params['projectId'] as string,
        req.user!.id,
      );
      res.json({
        plan: result.plan,
        cutoffAt: result.cutoffAt,
        versions: result.versions.map(versionToDto),
      });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/:taskId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const body = updateTaskSchema.parse(req.body);
      const task = await deps.updateTask.execute({
        projectId,
        ownerUserId: req.user!.id,
        taskId,
        description: body.description,
        icon: body.icon,
        cover: body.cover,
        coverPosition: body.coverPosition,
        ralphMode: body.ralphMode,
        deadline: body.deadline,
        startDate: body.startDate,
        priority: body.priority,
      });
      deps.notifyTaskChanged(projectId);
      res.json({ task: toDto(task) });
    } catch (e) {
      next(e);
    }
  });

  // Версии задачи (окно версий + restore, как в Notion). Гейтинг 7 дней — на сервере.
  router.get('/:taskId/versions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deps.getTaskVersions.execute(
        req.params['projectId'] as string,
        req.params['taskId'] as string,
        req.user!.id,
      );
      res.json({
        plan: result.plan,
        cutoffAt: result.cutoffAt,
        versions: result.versions.map(versionToDto),
      });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/:taskId/versions/:versionId/restore',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const task = await deps.restoreTaskVersion.execute({
          projectId,
          taskId: req.params['taskId'] as string,
          versionId: req.params['versionId'] as string,
          ownerUserId: req.user!.id,
        });
        deps.notifyTaskChanged(projectId);
        res.json({ task: toDto(task) });
      } catch (e) {
        next(e);
      }
    },
  );

  router.post('/:taskId/move', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const body = moveTaskSchema.parse(req.body);
      // Снимаем старый статус ДО move — нужен для SSE task_status_changed payload.
      // Если задача не найдена — move сам бросит 404; здесь просто гоним дальше.
      const before = await deps.tasks.getById(taskId);
      const task = await deps.moveTask.execute({
        projectId,
        ownerUserId: req.user!.id,
        taskId,
        targetStatus: body.targetStatus,
        beforeTaskId: body.beforeTaskId,
        afterTaskId: body.afterTaskId,
        restore: body.restore,
      });
      deps.notifyTaskChanged(projectId);
      if (before && before.status !== task.status) {
        deps.notifyStatusChanged(projectId, taskId, before.status, task.status, req.user!.id);
        if (body.targetStatus === 'done') {
          void deps.notifier.onTaskDone(projectId, req.user!.id, task, 'team').catch(() => {});
        } else {
          void deps.notifier.onStatusChanged(projectId, req.user!.id, task, before.status, task.status, 'team').catch(() => {});
        }
        const oldLabel = TG_STATUS_LABEL[before.status] ?? before.status;
        const newLabel = TG_STATUS_LABEL[task.status] ?? task.status;
        fireTgBroadcast(deps, taskId, projectId, req.user!.id, (pn) =>
          `🔄 Статус задачи изменён в «${pn}» (${oldLabel} → ${newLabel}):\n<i>${markdownToTelegramHtml(tgExcerpt(task.description))}</i>`,
          'status_change',
        );
      }
      res.json({ task: toDto(task) });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/:taskId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      await deps.deleteTask.execute(projectId, req.user!.id, taskId);
      deps.notifyTaskChanged(projectId);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // Корзина проекта (db/134). Зарегистрировано ПОСЛЕ /:taskId-роутов только по стилю файла:
  // конфликта нет — bare `GET /:taskId` в этом роутере не существует.
  router.get('/trash', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const trashed = await deps.listTrashedTasks.execute(projectId, req.user!.id);
      res.json({ tasks: trashed.map(toDto) });
    } catch (e) {
      next(e);
    }
  });

  // Undo удаления: задача возвращается с ТЕМ ЖЕ id, поэтому ссылки на неё,
  // комментарии и история версий переживают откат.
  router.post(
    '/trash/:taskId/restore',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const task = await deps.restoreDeletedTask.execute(projectId, req.user!.id, taskId);
        deps.notifyTaskChanged(projectId);
        res.json({ task: toDto(task) });
      } catch (e) {
        next(e);
      }
    },
  );

  // «Удалить навсегда»: физический DELETE задачи из корзины, Undo после этого нет.
  router.delete('/trash/:taskId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      await deps.purgeDeletedTask.execute(projectId, req.user!.id, taskId);
      deps.notifyTaskChanged(projectId);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // POST /:taskId/assign-to-project — перенос задачи в другой проект (из инбокса —
  // owner, из именованного — move_task; права гейтит use-case по task.projectId).
  // Ответственный сохраняется, если он состоит в целевом проекте; иначе им становится caller.
  router.post(
    '/:taskId/assign-to-project',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const taskId = req.params['taskId'] as string;
        const body = assignToProjectSchema.parse(req.body);
        const task = await deps.assignToProject.execute(
          taskId,
          body.targetProjectId,
          req.user!.id,
        );
        // Notify оба проекта: source (inbox) и target — обоим UI важно перерисоваться.
        deps.notifyTaskChanged(req.params['projectId'] as string);
        deps.notifyTaskChanged(body.targetProjectId);
        res.json({ task: toDto(task) });
      } catch (e) {
        next(e);
      }
    },
  );

  // PUT /:taskId/assignee — один путь для назначения, переназначения и «забрать себе».
  router.put(
    '/:taskId/assignee',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const body = changeTaskAssigneeSchema.parse(req.body);
        const task = await deps.changeAssignee.execute(
          projectId,
          taskId,
          req.user!.id,
          body.assigneeUserId,
        );
        deps.notifyTaskChanged(projectId);
        res.json({ task: toDto(task) });
      } catch (e) {
        next(e);
      }
    },
  );

  // POST /:taskId/ralph-cancel — запрос на отмену работы Ralph (pull-based флаг).
  // Идемпотентно: повторный POST не апдейтит timestamp.
  router.post('/:taskId/ralph-cancel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const task = await deps.requestRalphCancel.execute({
        projectId,
        ownerUserId: req.user!.id,
        taskId,
      });
      deps.notifyTaskChanged(projectId);
      res.json({ task: toDto(task) });
    } catch (e) {
      next(e);
    }
  });

  // DELETE /:taskId/ralph-cancel — отозвать запрос (только автор или admin).
  router.delete('/:taskId/ralph-cancel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const task = await deps.revokeRalphCancel.execute({
        projectId,
        ownerUserId: req.user!.id,
        taskId,
      });
      deps.notifyTaskChanged(projectId);
      res.json({ task: toDto(task) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/:taskId/commits', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const commits = await deps.listTaskCommits.execute(projectId, req.user!.id, taskId);
      res.json({ commits: commits.map(commitToDto) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/:taskId/commits', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const body = linkCommitSchema.parse(req.body);
      const commit = await deps.linkCommit.execute({
        projectId,
        ownerUserId: req.user!.id,
        taskId,
        sha: body.sha,
      });
      void deps.notifier.onCommitLinked(projectId, req.user!.id, taskId, 'team').catch(() => {});
      res.status(201).json({ commit: commitToDto(commit) });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/:taskId/commits/:sha', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const sha = req.params['sha'] as string;
      await deps.unlinkCommit.execute(projectId, req.user!.id, taskId, sha);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post('/sync-commits', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const result = await deps.syncTaskCommits.execute(projectId, req.user!.id);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // Attachments. Storage — backend filesystem; binary возвращается через
  // отдельный auth-gated /api/attachments/:id (см. http.ts), здесь только meta.
  router.get('/:taskId/attachments', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const list = await deps.listAttachments.execute(projectId, req.user!.id, taskId);
      res.json({ attachments: list.map(attachmentToDto) });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/:taskId/attachments',
    upload.single('file'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const file = req.file;
        if (!file) {
          res.status(400).json({ error: 'no_file', message: 'Файл не приложен' });
          return;
        }
        const att = await deps.uploadAttachment.execute({
          projectId,
          ownerUserId: req.user!.id,
          taskId,
          filename: decodeFilename(file.originalname),
          mimeType: file.mimetype,
          data: file.buffer,
        });
        res.status(201).json({ attachment: attachmentToDto(att) });
      } catch (e) {
        next(e);
      }
    },
  );

  router.delete(
    '/:taskId/attachments/:attachmentId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const attachmentId = req.params['attachmentId'] as string;
        await deps.deleteAttachment.execute(projectId, req.user!.id, taskId, attachmentId);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  // Comments
  router.get('/:taskId/comments', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const list = await deps.listComments.execute(projectId, req.user!.id, taskId);
      res.json({ comments: list.map(commentToDto) });
    } catch (e) {
      next(e);
    }
  });

  // Журнал доставки уведомлений по комментарию — для меню ⋮ «Кто уведомлён».
  router.get(
    '/:taskId/comments/:commentId/notifications',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const commentId = req.params['commentId'] as string;
        const view = await deps.getCommentNotifications.execute(
          projectId,
          req.user!.id,
          taskId,
          commentId,
        );
        res.json({
          notifyMode: view.notifyMode,
          recipients: view.recipients.map((r) => ({
            userId: r.recipientUserId,
            displayName: r.displayName,
            avatarUrl: r.avatarUrl,
            channel: r.channel,
            status: r.status,
            reason: r.reason,
            createdAt: r.createdAt.toISOString(),
          })),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  router.post('/:taskId/comments', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const body = createTaskCommentSchema.parse(req.body);
      const audience = body.notify ?? { mode: 'all' as const };
      const comment = await deps.createComment.execute({
        projectId,
        ownerUserId: req.user!.id,
        taskId,
        body: body.body,
        // Все человеческие роуты — actorKind='user' (default, но явно для читаемости).
        actorKind: 'user',
        notifyMode: audience.mode,
        replyToCommentId: body.replyToCommentId ?? null,
        quotedText: body.quotedText ?? null,
      });
      deps.notifyTaskChanged(projectId);
      deps.notifyCommentAdded(
        projectId,
        taskId,
        comment.id,
        req.user!.id,
        comment.actorKind,
        comment.agentName,
      );
      // Авто-возврат awaiting_clarification → in_progress по маркеру в комменте.
      // Best-effort: ошибка не должна ломать ответ на создание коммента.
      try {
        const reopened = await deps.maybeReopenForClarification.execute(
          taskId,
          body.body,
          req.user!.id,
        );
        if (reopened) {
          deps.notifyStatusChanged(
            projectId,
            taskId,
            reopened.oldStatus,
            reopened.newStatus,
            req.user!.id,
          );
          deps.notifyTaskChanged(projectId);
        }
      } catch (err) {
        console.warn('[auto-reopen] failed for task', taskId, err);
      }
      // Адресные уведомления (email + Telegram) + журнал доставки. Один оркестратор
      // вместо раздельных onComment/fireTgBroadcast — единый источник «кто уведомлён».
      // Fire-and-forget: ошибки рассылки не влияют на ответ.
      void deps.dispatchCommentNotifications
        .execute({
          projectId,
          actorUserId: req.user!.id,
          source: 'team',
          audience,
          comment: {
            id: comment.id,
            taskId,
            body: body.body,
            actorKind: comment.actorKind,
            agentName: comment.agentName,
            replyToCommentId: comment.replyToCommentId,
          },
        })
        .catch((err) => console.warn('[tasks/comment-dispatch] failed:', err));
      res.status(201).json({ comment: commentToDto(comment) });
    } catch (e) {
      next(e);
    }
  });

  router.patch(
    '/:taskId/comments/:commentId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const commentId = req.params['commentId'] as string;
        const body = updateTaskCommentSchema.parse(req.body);
        const comment = await deps.updateComment.execute({
          projectId,
          ownerUserId: req.user!.id,
          taskId,
          commentId,
          body: body.body,
        });
        deps.notifyTaskChanged(projectId);
        res.json({ comment: commentToDto(comment) });
      } catch (e) {
        next(e);
      }
    },
  );

  router.delete(
    '/:taskId/comments/:commentId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const commentId = req.params['commentId'] as string;
        await deps.deleteComment.execute(projectId, req.user!.id, taskId, commentId);
        deps.notifyTaskChanged(projectId);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  // Comment attachments — переиспользуют uploadAttachment с commentId. Бинарь отдаётся
  // тем же /api/attachments/:id (auth через task→project).
  router.post(
    '/:taskId/comments/:commentId/attachments',
    upload.single('file'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const commentId = req.params['commentId'] as string;
        const file = req.file;
        if (!file) {
          res.status(400).json({ error: 'no_file', message: 'Файл не приложен' });
          return;
        }
        const att = await deps.uploadAttachment.execute({
          projectId,
          ownerUserId: req.user!.id,
          taskId,
          commentId,
          filename: decodeFilename(file.originalname),
          mimeType: file.mimetype,
          data: file.buffer,
        });
        res.status(201).json({ attachment: attachmentToDto(att) });
      } catch (e) {
        next(e);
      }
    },
  );

  router.delete(
    '/:taskId/comments/:commentId/attachments/:attachmentId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const attachmentId = req.params['attachmentId'] as string;
        await deps.deleteAttachment.execute(projectId, req.user!.id, taskId, attachmentId);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
