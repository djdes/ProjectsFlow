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
import type { Task } from '../../domain/task/Task.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { AgentJobRepository } from '../../application/agent/AgentJobRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { agentJobToDto } from '../agent-jobs/dto.js';
import {
  createTaskCommentSchema,
  createTaskSchema,
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
  readonly maxAttachmentBytes: number;
  readonly agentJobs: AgentJobRepository;
  // Live-обновление: сигнал «в проекте изменились задачи» всем участникам (SSE).
  // Best-effort, не блокирует ответ.
  readonly notifyTaskChanged: (projectId: string) => void;
};

type TaskDto = Omit<Task, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
  commitCount?: number;
  attachmentCount?: number;
  commentCount?: number;
};

function toDto(t: Task | TaskWithCounts): TaskDto {
  const base: TaskDto = {
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
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
};

function commentToDto(c: TaskComment): CommentDto {
  return { ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
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
      const activeJobs = await deps.agentJobs.findActiveByTaskIds(list.map((t) => t.id));
      res.json({
        tasks: list.map((t) => ({
          ...toDto(t),
          agentJob: activeJobs.get(t.id) ? agentJobToDto(activeJobs.get(t.id)!) : null,
        })),
      });
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
      });
      deps.notifyTaskChanged(projectId);
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
      const task = await deps.moveTask.execute({
        projectId,
        ownerUserId: req.user!.id,
        taskId,
        targetStatus: body.targetStatus,
        beforeTaskId: body.beforeTaskId,
        afterTaskId: body.afterTaskId,
      });
      deps.notifyTaskChanged(projectId);
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
      });
      deps.notifyTaskChanged(projectId);
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

  return router;
}
