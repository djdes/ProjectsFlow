import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { ListTasks, TaskWithCounts } from '../../application/task/ListTasks.js';
import type { CreateTask } from '../../application/task/CreateTask.js';
import type { UpdateTask } from '../../application/task/UpdateTask.js';
import type { MoveTask } from '../../application/task/MoveTask.js';
import type { DeleteTask } from '../../application/task/DeleteTask.js';
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
import type { AssignInboxTaskToProject } from '../../application/task/AssignInboxTaskToProject.js';
import type { DelegateExistingTask } from '../../application/task/DelegateExistingTask.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import { requireAuth } from '../middleware/requireAuth.js';
import type { ProjectNotificationService } from '../../application/notifications/ProjectNotificationService.js';
import type { TaskRepository } from '../../application/task/TaskRepository.js';
import type { MaybeReopenForClarification } from '../../application/task/MaybeReopenForClarification.js';
import {
  assignToProjectSchema,
  createTaskCommentSchema,
  createTaskSchema,
  delegateTaskSchema,
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
  readonly assignToProject: AssignInboxTaskToProject;
  readonly delegateExisting: DelegateExistingTask;
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
};

type TaskDelegationDto = {
  id: string;
  taskId: string;
  delegateUserId: string;
  delegateDisplayName: string;
  creatorUserId: string;
  creatorDisplayName: string;
  status: string;
  createdAt: string;
  respondedAt: string | null;
};

type TaskDto = Omit<
  Task,
  'createdAt' | 'updatedAt' | 'ralphCancelRequestedAt' | 'delegation'
> & {
  createdAt: string;
  updatedAt: string;
  // Сериализуем как ISO-string чтоб клиент парсил через Date(...). null если нет запроса.
  ralphCancelRequestedAt: string | null;
  commitCount?: number;
  attachmentCount?: number;
  commentCount?: number;
  // Активная (pending|accepted) делегация. null если задача не делегирована.
  // undefined невозможен на проводе — backend всегда выдаёт null.
  delegation: TaskDelegationDto | null;
};

function toDto(t: Task | TaskWithCounts): TaskDto {
  // Извлекаем delegation отдельно: дату надо отдельно сериализовать; rest нельзя
  // спрэдить как есть (там Date-объекты).
  const { delegation: _delegationOriginal, ...rest } = t;
  const base: TaskDto = {
    ...rest,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    ralphCancelRequestedAt: t.ralphCancelRequestedAt
      ? t.ralphCancelRequestedAt.toISOString()
      : null,
    delegation: t.delegation
      ? {
          id: t.delegation.id,
          taskId: t.delegation.taskId,
          delegateUserId: t.delegation.delegateUserId,
          delegateDisplayName: t.delegation.delegateDisplayName,
          creatorUserId: t.delegation.creatorUserId,
          creatorDisplayName: t.delegation.creatorDisplayName,
          status: t.delegation.status,
          createdAt: t.delegation.createdAt.toISOString(),
          respondedAt: t.delegation.respondedAt
            ? t.delegation.respondedAt.toISOString()
            : null,
        }
      : null,
  };
  if ('commitCount' in t) base.commitCount = t.commitCount;
  if ('attachmentCount' in t) base.attachmentCount = t.attachmentCount;
  if ('commentCount' in t) base.commentCount = t.commentCount;
  return base;
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
        status: body.status ?? 'todo',
        ralphMode: body.ralphMode,
        delegateUserId: body.delegateUserId ?? null,
        deadline: body.deadline ?? null,
        priority: body.priority ?? null,
      });
      deps.notifyTaskChanged(projectId);
      void deps.notifier.onTaskCreated(projectId, req.user!.id, task, 'team').catch(() => {});
      res.status(201).json({ task: toDto(task) });
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
        ralphMode: body.ralphMode,
        deadline: body.deadline,
        priority: body.priority,
      });
      deps.notifyTaskChanged(projectId);
      res.json({ task: toDto(task) });
    } catch (e) {
      next(e);
    }
  });

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
      });
      deps.notifyTaskChanged(projectId);
      if (before && before.status !== task.status) {
        deps.notifyStatusChanged(projectId, taskId, before.status, task.status, req.user!.id);
      }
      if (body.targetStatus === 'done') {
        void deps.notifier.onTaskDone(projectId, req.user!.id, task, 'team').catch(() => {});
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

  // POST /:taskId/assign-to-project — перенос inbox-задачи в реальный проект.
  // Активная делегация (если есть) → archived; делегат получает email + notification.
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

  // POST /:taskId/delegate — делегировать уже созданную inbox-задачу.
  // Возвращает обновлённую task (с delegation = pending). UI сам перерисует ярлык.
  router.post(
    '/:taskId/delegate',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const taskId = req.params['taskId'] as string;
        const body = delegateTaskSchema.parse(req.body);
        const delegation = await deps.delegateExisting.execute(
          taskId,
          body.delegateUserId,
          req.user!.id,
        );
        const task = await deps.tasks.getById(taskId);
        if (!task) {
          res.status(404).json({ error: 'task_not_found' });
          return;
        }
        deps.notifyTaskChanged(req.params['projectId'] as string);
        // Прикручиваем delegation к task — DrizzleTaskRepository.getById не джойнит.
        res.json({ task: toDto({ ...task, delegation }) });
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
          filename: file.originalname,
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

  router.post('/:taskId/comments', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const body = createTaskCommentSchema.parse(req.body);
      const comment = await deps.createComment.execute({
        projectId,
        ownerUserId: req.user!.id,
        taskId,
        body: body.body,
        // Все человеческие роуты — actorKind='user' (default, но явно для читаемости).
        actorKind: 'user',
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
        const reopened = await deps.maybeReopenForClarification.execute(taskId, body.body);
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
      void deps.notifier.onComment(projectId, req.user!.id, taskId, body.body, 'team').catch(() => {});
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
          filename: file.originalname,
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
