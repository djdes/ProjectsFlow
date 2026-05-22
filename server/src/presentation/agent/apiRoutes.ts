import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { ListProjects } from '../../application/project/ListProjects.js';
import type { ProjectNotificationService } from '../../application/notifications/ProjectNotificationService.js';
import type { CreateProjectWithGit } from '../../application/project/CreateProjectWithGit.js';
import type { UpdateProject } from '../../application/project/UpdateProject.js';
import type { ListUserRepos } from '../../application/github/ListUserRepos.js';
import type { GithubRepoSummary } from '../../domain/github/GithubConnection.js';
import type { ListKbDocuments } from '../../application/kb/ListKbDocuments.js';
import type { GetAgentCredential } from '../../application/agent/GetAgentCredential.js';
import type { GetAgentTask } from '../../application/agent/GetAgentTask.js';
import type { CreateAgentCredential } from '../../application/agent/CreateAgentCredential.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { ListTasks } from '../../application/task/ListTasks.js';
import type { CreateTask } from '../../application/task/CreateTask.js';
import type { CreateTaskComment } from '../../application/task/CreateTaskComment.js';
import type { MoveTask } from '../../application/task/MoveTask.js';
import type { LinkCommit } from '../../application/task/LinkCommit.js';
import type { WriteKbDocument } from '../../application/kb/WriteKbDocument.js';
import type { ListPendingAgentJobs } from '../../application/agent/ListPendingAgentJobs.js';
import type { ClaimAgentJob } from '../../application/agent/ClaimAgentJob.js';
import type { CompleteAgentJob } from '../../application/agent/CompleteAgentJob.js';
import type { PendingAgentJob } from '../../application/agent/AgentJobRepository.js';
import type { Frontmatter } from '../../domain/kb/Frontmatter.js';
import type { Project } from '../../domain/project/Project.js';
import type { KbDocumentSummary } from '../../domain/kb/KbDocument.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import { agentJobToDto } from '../agent-jobs/dto.js';
import {
  taskStatusSchema,
  linkCommitSchema,
  createTaskSchema,
  createTaskCommentSchema,
} from '../tasks/schemas.js';
import { writeDocSchema } from '../kb/schemas.js';

type Deps = {
  readonly authenticate: AuthenticateAgentToken;
  readonly listProjects: ListProjects;
  readonly createProjectWithGit: CreateProjectWithGit;
  readonly updateProject: UpdateProject;
  readonly listUserRepos: ListUserRepos;
  readonly listKbDocuments: ListKbDocuments;
  readonly getCredential: GetAgentCredential;
  readonly createCredential: CreateAgentCredential;
  readonly listTasks: ListTasks;
  readonly getTask: GetAgentTask;
  readonly createTask: CreateTask;
  readonly createComment: CreateTaskComment;
  readonly moveTask: MoveTask;
  readonly linkCommit: LinkCommit;
  readonly writeKbDocument: WriteKbDocument;
  readonly listPendingAgentJobs: ListPendingAgentJobs;
  readonly claimAgentJob: ClaimAgentJob;
  readonly completeAgentJob: CompleteAgentJob;
  // Email-оповещения команде (источник 'mcp' — действия агента). Fire-and-forget.
  readonly notifier: ProjectNotificationService;
};

const createCredentialSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.string().trim().min(1).max(80).nullable().optional(),
  slug: z.string().trim().min(1).max(80).nullable().optional(),
  fields: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(80),
        value: z.string().max(20_000),
        isSecret: z.boolean(),
      }),
    )
    .min(1, 'нужно хотя бы одно поле')
    .max(50),
});

const moveTaskAgentSchema = z.object({
  targetStatus: taskStatusSchema,
});

type TaskDto = Omit<Task, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
  commitCount?: number;
  commentCount?: number;
};

function taskToDto(t: Task & { commitCount?: number; commentCount?: number }): TaskDto {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

type CommitDto = Omit<TaskCommit, 'committedAt' | 'linkedAt'> & {
  committedAt: string;
  linkedAt: string;
};

function commitToDto(c: TaskCommit): CommitDto {
  return { ...c, committedAt: c.committedAt.toISOString(), linkedAt: c.linkedAt.toISOString() };
}

type CommentDto = Omit<TaskComment, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

function commentToDto(c: TaskComment): CommentDto {
  return { ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
}

type PendingAgentJobDto = Omit<PendingAgentJob, 'createdAt'> & { createdAt: string };

function pendingAgentJobToDto(p: PendingAgentJob): PendingAgentJobDto {
  return { ...p, createdAt: p.createdAt.toISOString() };
}

const completeAgentJobBodySchema = z.object({
  ok: z.boolean(),
  prUrl: z.string().url().nullable().optional(),
  error: z.string().max(4000).nullable().optional(),
  branchName: z.string().max(200).nullable().optional(),
});

// git-опция при создании проекта: подключить существующий репо / создать новый / никакой.
const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  git: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('none') }),
      z.object({ mode: z.literal('connect'), gitRepoUrl: z.string().url() }),
      z.object({
        mode: z.literal('create'),
        repoName: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(350).optional(),
        private: z.boolean().optional(),
      }),
    ])
    .optional(),
});

const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    gitRepoUrl: z.string().url().nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.gitRepoUrl !== undefined, {
    message: 'нужно хотя бы одно поле (name или gitRepoUrl)',
  });

type ProjectDto = {
  id: string;
  name: string;
  status: Project['status'];
  hasKb: boolean;
  gitRepoUrl: string | null;
};

function projectToAgentDto(p: Project): ProjectDto {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    hasKb: p.kbRepoFullName !== null,
    gitRepoUrl: p.gitRepoUrl,
  };
}

type RepoDto = {
  fullName: string;
  htmlUrl: string;
  description: string | null;
  private: boolean;
  pushedAt: string | null;
};

function repoToDto(r: GithubRepoSummary): RepoDto {
  return {
    fullName: r.fullName,
    htmlUrl: r.htmlUrl,
    description: r.description,
    private: r.private,
    pushedAt: r.pushedAt ? r.pushedAt.toISOString() : null,
  };
}

// Endpoints для agents (MCP-сервер). Авторизация через Bearer-токен.
export function agentApiRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAgentToken(deps.authenticate));

  // Список проектов юзера, к которому привязан токен. Возвращаем минимум meta:
  // id, name, hasKb, gitRepoUrl — этого достаточно агенту чтоб выбрать.
  router.get('/projects', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.listProjects.execute(req.user!.id);
      res.json({
        projects: list.map((p: Project) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          hasKb: p.kbRepoFullName !== null,
          gitRepoUrl: p.gitRepoUrl,
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  // GitHub-репозитории пользователя — чтобы перед созданием проекта агент мог найти
  // похожий по названию и предложить «подключить существующий».
  router.get('/repos', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repos = await deps.listUserRepos.execute(req.user!.id);
      res.json({ repos: repos.map(repoToDto) });
    } catch (e) {
      next(e);
    }
  });

  // Создание нового проекта. git-режим выбирает пользователь (агент спрашивает заранее):
  // none — без репо; connect — привязать существующий gitRepoUrl; create — завести
  // новый репозиторий под GitHub-аккаунтом пользователя и привязать его.
  router.post('/projects', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createProjectSchema.parse(req.body);
      const project = await deps.createProjectWithGit.execute({
        ownerId: req.user!.id,
        name: body.name,
        git: body.git ?? { mode: 'none' },
      });
      res.status(201).json({ project: projectToAgentDto(project) });
    } catch (e) {
      next(e);
    }
  });

  // Изменение проекта: переименование и/или привязка git-репо. Требует роль editor+.
  router.patch('/projects/:projectId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const body = updateProjectSchema.parse(req.body);
      const project = await deps.updateProject.execute({
        id: projectId,
        ownerId: req.user!.id,
        patch: { name: body.name, gitRepoUrl: body.gitRepoUrl },
      });
      res.json({ project: projectToAgentDto(project) });
    } catch (e) {
      next(e);
    }
  });

  // Список credential-файлов в проекте (только path + title из frontmatter, без секретов).
  // Агент использует это чтобы найти нужный slug.
  router.get(
    '/projects/:projectId/credentials',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const docs = await deps.listKbDocuments.execute(projectId, req.user!.id);
        const creds = docs
          .filter((d: KbDocumentSummary) => d.path.startsWith('credentials/'))
          .map((d: KbDocumentSummary) => ({
            slug: d.path.replace(/^credentials\//, '').replace(/\.md$/, ''),
            path: d.path,
            title: (d.frontmatter['title'] as string | undefined) ?? null,
            kind: (d.frontmatter['kind'] as string | undefined) ?? null,
          }));
        res.json({ credentials: creds });
      } catch (e) {
        next(e);
      }
    },
  );

  // Получение полного credential'а с резолвленными vault://-полями. Plaintext-секреты!
  router.get(
    '/projects/:projectId/credentials/:slug',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const slug = req.params['slug'] as string;
        const credential = await deps.getCredential.execute(projectId, req.user!.id, slug);
        res.json({ credential });
      } catch (e) {
        next(e);
      }
    },
  );

  // Создание credential'а из агента: structured fields с явным isSecret.
  // Секреты идут в vault (secrets-таблица), публичные поля — во frontmatter.
  router.post(
    '/projects/:projectId/credentials',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const body = createCredentialSchema.parse(req.body);
        const result = await deps.createCredential.execute({
          projectId,
          userId: req.user!.id,
          title: body.title,
          kind: body.kind ?? null,
          slug: body.slug ?? null,
          fields: body.fields,
        });
        res.status(201).json({ credential: result });
      } catch (e) {
        next(e);
      }
    },
  );

  // Список tasks в проекте — для LLM-judgment'а в Claude Code. Агент читает список,
  // сопоставляет с diff/commit-message и предлагает юзеру move/link.
  router.get(
    '/projects/:projectId/tasks',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const list = await deps.listTasks.execute(projectId, req.user!.id);
        res.json({ tasks: list.map(taskToDto) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Создание task'а из агента. По умолчанию падает в TODO внизу колонки.
  router.post(
    '/projects/:projectId/tasks',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const body = createTaskSchema.parse(req.body);
        const task = await deps.createTask.execute({
          projectId,
          ownerUserId: req.user!.id,
          description: body.description,
          status: body.status ?? 'todo',
        });
        void deps.notifier.onTaskCreated(projectId, req.user!.id, task, 'mcp').catch(() => {});
        // taskToDto ожидает Task с commitCount, но из CreateTask он не приходит — оборачиваем
        // вручную с нулевым счётчиком; в БД у новой задачи коммитов нет по определению.
        res.status(201).json({ task: taskToDto({ ...task, commitCount: 0 }) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Полный task с binary'ями всех аттачей в base64 + список комментариев. Для
  // pf_get_task tool'а — вызывается когда агенту нужно увидеть скрины/файлы и
  // прочитать предыдущее обсуждение задачи. Comments по порядку (старые сверху).
  router.get(
    '/projects/:projectId/tasks/:taskId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const { task, attachments, comments } = await deps.getTask.execute(
          projectId,
          req.user!.id,
          taskId,
        );
        res.json({
          task: taskToDto(task),
          attachments: attachments.map(
            (a: TaskAttachment & { data: Buffer }) => ({
              id: a.id,
              filename: a.filename,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              uploadedAt: a.uploadedAt.toISOString(),
              dataBase64: a.data.toString('base64'),
            }),
          ),
          comments: comments.map(commentToDto),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  // Создание комментария к задаче из агента. Используется чтобы LLM оставляла
  // прогресс-апдейты по ходу работы: «начал», «обнаружил блокер», «PR открыт».
  // Mentions через @displayName парсятся существующим CreateTaskComment use-case'ом
  // и шлют notifications упомянутым юзерам. Comment author = owner текущего
  // agent-токена — т.е. под именем юзера, выпустившего токен.
  router.post(
    '/projects/:projectId/tasks/:taskId/comments',
    async (req: Request, res: Response, next: NextFunction) => {
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
        void deps.notifier.onComment(projectId, req.user!.id, taskId, body.body, 'mcp').catch(() => {});
        res.status(201).json({ comment: commentToDto(comment) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Перенос task на другой статус. before/after не принимаем — агент всегда кладёт
  // в конец целевой колонки (MoveTask с before=null/after=null). Юзер при необходимости
  // подвинет руками в UI; это краевой случай.
  router.post(
    '/projects/:projectId/tasks/:taskId/move',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const body = moveTaskAgentSchema.parse(req.body);
        const task = await deps.moveTask.execute({
          projectId,
          ownerUserId: req.user!.id,
          taskId,
          targetStatus: body.targetStatus,
          beforeTaskId: null,
          afterTaskId: null,
        });
        if (body.targetStatus === 'done') {
          void deps.notifier.onTaskDone(projectId, req.user!.id, task, 'mcp').catch(() => {});
        }
        res.json({ task: taskToDto(task) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Запись произвольного KB-документа (create или update). Если sha=null —
  // создаём новый файл; если sha передан — обновляем существующий (optimistic lock).
  router.post(
    '/projects/:projectId/kb/documents',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const body = writeDocSchema.parse(req.body);
        const result = await deps.writeKbDocument.execute({
          projectId,
          userId: req.user!.id,
          path: body.path,
          frontmatter: body.frontmatter as Frontmatter,
          body: body.body,
          sha: body.sha,
        });
        void deps.notifier
          .onKbUpdated(projectId, req.user!.id, body.path, 'mcp')
          .catch(() => {});
        res.status(201).json({ path: body.path, sha: result.sha });
      } catch (e) {
        next(e);
      }
    },
  );

  // Привязка коммита к task. SHA должен быть доступен на GitHub (commit запушен).
  // LinkCommit сам делает auto-transition `todo → in_progress` на первом коммите.
  router.post(
    '/projects/:projectId/tasks/:taskId/commits',
    async (req: Request, res: Response, next: NextFunction) => {
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
        void deps.notifier.onCommitLinked(projectId, req.user!.id, taskId, 'mcp').catch(() => {});
        res.status(201).json({ commit: commitToDto(commit) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Список queued job'ов пользователя по всем проектам — для /loop polling'а.
  // Агент вызывает периодически чтобы найти и claim'нуть новую задачу.
  router.get('/pending-agent-jobs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limitParam = req.query['limit'];
      const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : undefined;
      const jobs = await deps.listPendingAgentJobs.execute({
        userId: req.user!.id,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      res.json({ jobs: jobs.map(pendingAgentJobToDto) });
    } catch (e) {
      next(e);
    }
  });

  // Атомарный claim job'а: queued → running. Возвращает полный AgentJob.
  // Если job уже claim'нута другой сессией — 409 agent_job_already_claimed.
  router.post('/agent-jobs/:jobId/claim', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params['jobId'] as string;
      const job = await deps.claimAgentJob.execute({ userId: req.user!.id, jobId });
      res.json({ job: agentJobToDto(job) });
    } catch (e) {
      next(e);
    }
  });

  // Завершение job'а: running → succeeded/failed. Тело: { ok, prUrl?, error?, branchName? }.
  // Если job не в running-состоянии — 409 agent_job_not_in_running_state.
  router.post('/agent-jobs/:jobId/complete', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params['jobId'] as string;
      const body = completeAgentJobBodySchema.parse(req.body);
      await deps.completeAgentJob.execute({
        userId: req.user!.id,
        jobId,
        ok: body.ok,
        prUrl: body.prUrl ?? null,
        error: body.error ?? null,
        branchName: body.branchName ?? null,
      });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
