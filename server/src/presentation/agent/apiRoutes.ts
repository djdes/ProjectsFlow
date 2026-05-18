import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { ListProjects } from '../../application/project/ListProjects.js';
import type { ListKbDocuments } from '../../application/kb/ListKbDocuments.js';
import type { GetAgentCredential } from '../../application/agent/GetAgentCredential.js';
import type { GetAgentTask } from '../../application/agent/GetAgentTask.js';
import type { CreateAgentCredential } from '../../application/agent/CreateAgentCredential.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { ListTasks } from '../../application/task/ListTasks.js';
import type { CreateTask } from '../../application/task/CreateTask.js';
import type { MoveTask } from '../../application/task/MoveTask.js';
import type { LinkCommit } from '../../application/task/LinkCommit.js';
import type { WriteKbDocument } from '../../application/kb/WriteKbDocument.js';
import type { Frontmatter } from '../../domain/kb/Frontmatter.js';
import type { Project } from '../../domain/project/Project.js';
import type { KbDocumentSummary } from '../../domain/kb/KbDocument.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import { taskStatusSchema, linkCommitSchema, createTaskSchema } from '../tasks/schemas.js';
import { writeDocSchema } from '../kb/schemas.js';

type Deps = {
  readonly authenticate: AuthenticateAgentToken;
  readonly listProjects: ListProjects;
  readonly listKbDocuments: ListKbDocuments;
  readonly getCredential: GetAgentCredential;
  readonly createCredential: CreateAgentCredential;
  readonly listTasks: ListTasks;
  readonly getTask: GetAgentTask;
  readonly createTask: CreateTask;
  readonly moveTask: MoveTask;
  readonly linkCommit: LinkCommit;
  readonly writeKbDocument: WriteKbDocument;
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
};

function taskToDto(t: Task & { commitCount?: number }): TaskDto {
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
        // taskToDto ожидает Task с commitCount, но из CreateTask он не приходит — оборачиваем
        // вручную с нулевым счётчиком; в БД у новой задачи коммитов нет по определению.
        res.status(201).json({ task: taskToDto({ ...task, commitCount: 0 }) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Полный task с binary'ями всех аттачей в base64. Для pf_get_task tool'а —
  // вызывается когда агенту нужно увидеть скрины/файлы, которые юзер прикрепил.
  router.get(
    '/projects/:projectId/tasks/:taskId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const { task, attachments } = await deps.getTask.execute(
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
        });
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
        res.status(201).json({ commit: commitToDto(commit) });
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
