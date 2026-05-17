import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ListTasks, TaskWithCommitCount } from '../../application/task/ListTasks.js';
import type { CreateTask } from '../../application/task/CreateTask.js';
import type { UpdateTask } from '../../application/task/UpdateTask.js';
import type { MoveTask } from '../../application/task/MoveTask.js';
import type { DeleteTask } from '../../application/task/DeleteTask.js';
import type { LinkCommit } from '../../application/task/LinkCommit.js';
import type { UnlinkCommit } from '../../application/task/UnlinkCommit.js';
import type { ListTaskCommits } from '../../application/task/ListTaskCommits.js';
import type { SyncTaskCommits } from '../../application/task/SyncTaskCommits.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { createTaskSchema, linkCommitSchema, moveTaskSchema, updateTaskSchema } from './schemas.js';

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
};

type TaskDto = Omit<Task, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
  commitCount?: number;
};

function toDto(t: Task | TaskWithCommitCount): TaskDto {
  const base: TaskDto = {
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
  if ('commitCount' in t) base.commitCount = t.commitCount;
  return base;
}

type CommitDto = Omit<TaskCommit, 'committedAt' | 'linkedAt'> & {
  committedAt: string;
  linkedAt: string;
};

function commitToDto(c: TaskCommit): CommitDto {
  return { ...c, committedAt: c.committedAt.toISOString(), linkedAt: c.linkedAt.toISOString() };
}

export function tasksRouter(deps: Deps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

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
        title: body.title,
        description: body.description ?? null,
        status: body.status ?? 'todo',
      });
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
        title: body.title,
        description: body.description,
      });
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

  return router;
}
