import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ListProjects, ProjectWithRole } from '../../application/project/ListProjects.js';
import type { GetProject } from '../../application/project/GetProject.js';
import type { CreateProject } from '../../application/project/CreateProject.js';
import type { UpdateProject } from '../../application/project/UpdateProject.js';
import type { DeleteProject } from '../../application/project/DeleteProject.js';
import type { PublishProject } from '../../application/project/PublishProject.js';
import type { UnpublishProject } from '../../application/project/UnpublishProject.js';
import type { SetPublicIndexing } from '../../application/project/SetPublicIndexing.js';
import type { EnsureProjectAppRepo } from '../../application/project/EnsureProjectAppRepo.js';
import type { CreateProjectRepo } from '../../application/project/CreateProjectRepo.js';
import type { GetProjectSite } from '../../application/site/GetProjectSite.js';
import { publicBoardUrl } from '../../domain/project/publicBoardUrl.js';
import type { SetProjectDispatcher } from '../../application/project/SetProjectDispatcher.js';
import type { SetProjectMultiTaskWorker } from '../../application/project/SetProjectMultiTaskWorker.js';
import type { ListDispatcherCandidates } from '../../application/project/ListDispatcherCandidates.js';
import type { SetGitTokenDelegation } from '../../application/project/SetGitTokenDelegation.js';
import type { ListGitTokenAccessLog } from '../../application/project/ListGitTokenAccessLog.js';
import type { GitTokenDelegationRepository } from '../../application/project/GitTokenDelegationRepository.js';
import type { GithubTokenRepository } from '../../application/github/GithubTokenRepository.js';
import type { ProjectRepository } from '../../application/project/ProjectRepository.js';
import type { UserRepository } from '../../application/user/UserRepository.js';
import type { ReorderProjects } from '../../application/project/ReorderProjects.js';
import type { ToggleProjectFavorite } from '../../application/project/ToggleProjectFavorite.js';
import type { ReorderFavoriteProjects } from '../../application/project/ReorderFavoriteProjects.js';
import type { ListProjectMembers } from '../../application/project/ListProjectMembers.js';
import type { CheckGitCollision } from '../../application/project/CheckGitCollision.js';
import type { RequestProjectJoin } from '../../application/project/RequestProjectJoin.js';
import type { ResolveProjectJoinRequest } from '../../application/project/ResolveProjectJoinRequest.js';
import type {
  ProjectMemberRepository,
  ProjectMemberWithUser,
} from '../../application/project/ProjectMemberRepository.js';
import type { ProjectNotificationService } from '../../application/notifications/ProjectNotificationService.js';
import type { ListProjectCommits } from '../../application/github/ListProjectCommits.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { GithubCommit } from '../../domain/github/GithubConnection.js';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireProjectAccess } from '../../application/project/projectAccess.js';
import type { BoardViewRepository } from '../../application/project/BoardViewRepository.js';
import type { TaskTemplateRepository } from '../../application/task/TaskTemplateRepository.js';
import type { TaskTemplate } from '../../domain/task/TaskTemplate.js';
import type { TaskPropertyRepository } from '../../application/task/TaskPropertyRepository.js';
import type { TaskProperty } from '../../domain/task/TaskProperty.js';
import type { TaskRepository } from '../../application/task/TaskRepository.js';
import type { TaskVersionRecorder } from '../../application/task/TaskVersionRecorder.js';
import type { BoardView } from '../../domain/project/BoardView.js';
import type { AttachmentStorage } from '../../application/task/AttachmentStorage.js';
import {
  createBoardViewSchema,
  createProjectRepoSchema,
  createTaskTemplateSchema,
  createTaskPropertySchema,
  updateTaskPropertySchema,
  setTaskPropertyValueSchema,
  createProjectSchema,
  kanbanSettingsSchema,
  updateBoardViewSchema,
  notificationPrefsSchema,
  reorderFavoritesSchema,
  reorderProjectsSchema,
  setDispatcherSchema,
  setMultiTaskWorkerSchema,
  setPublicIndexingSchema,
  setGitTokenDelegationSchema,
  toggleFavoriteSchema,
  updateProjectSchema,
} from './schemas.js';

type Deps = {
  readonly listProjects: ListProjects;
  readonly getProject: GetProject;
  readonly createProject: CreateProject;
  readonly updateProject: UpdateProject;
  readonly deleteProject: DeleteProject;
  // Публичная ссылка доски (Publish to web, db/096). Owner-only.
  readonly publishProject: PublishProject;
  readonly unpublishProject: UnpublishProject;
  readonly setPublicIndexing: SetPublicIndexing;
  readonly ensureAppRepo: EnsureProjectAppRepo;
  readonly createProjectRepo: CreateProjectRepo;
  readonly getProjectSite: GetProjectSite;
  readonly setProjectDispatcher: SetProjectDispatcher;
  readonly setMultiTaskWorker: SetProjectMultiTaskWorker;
  readonly listDispatcherCandidates: ListDispatcherCandidates;
  readonly setGitTokenDelegation: SetGitTokenDelegation;
  readonly listGitTokenAccessLog: ListGitTokenAccessLog;
  // Прямое чтение делегации для GET-эндпоинта (mine/all) — без отдельного
  // use-case'а, потому что логика «view-only» тривиальная.
  readonly gitTokenDelegations: GitTokenDelegationRepository;
  // Для резолва displayName юзеров в access-log + githubLogin'ов в `all`-списке.
  readonly users: UserRepository;
  readonly githubTokens: GithubTokenRepository;
  // ProjectRepository — нужен в GET /git-token-delegation чтобы узнать ownerId
  // (определяет видимость `all`-блока) без отдельного use-case'а.
  readonly projects: ProjectRepository;
  // Пользовательские вью доски (Notion-style, db/103).
  readonly boardViews: BoardViewRepository;
  // Шаблоны задач (Notion Templates, db/108).
  readonly taskTemplates: TaskTemplateRepository;
  // Кастомные свойства задач (db/109) + tasks для IDOR-проверки value-роута.
  readonly taskProperties: TaskPropertyRepository;
  readonly tasks: TaskRepository;
  readonly taskVersions: TaskVersionRecorder;
  readonly reorderProjects: ReorderProjects;
  readonly toggleProjectFavorite: ToggleProjectFavorite;
  readonly reorderFavoriteProjects: ReorderFavoriteProjects;
  readonly listProjectCommits: ListProjectCommits;
  readonly listMembers: ListProjectMembers;
  readonly checkGitCollision: CheckGitCollision;
  readonly requestJoin: RequestProjectJoin;
  readonly resolveJoinRequest: ResolveProjectJoinRequest;
  // Базовый URL приложения — нужен для формирования invite-URL'а в ответе на создание.
  readonly appUrl: string;
  // Live-обновление: сигнал «проект изменился» всем участникам (SSE). Best-effort.
  readonly notifyProjectChanged: (projectId: string) => void;
  // Deep-link авто-switch активного пространства при открытии проекта. Best-effort.
  readonly setActiveWorkspaceForProject: (userId: string, projectId: string) => Promise<void>;
  // Email-оповещения команде (изменения состава) + чтение/запись пер-участниковых настроек.
  readonly notifier: ProjectNotificationService;
  readonly members: ProjectMemberRepository;
  // Хранилище обложек проекта (то же локальное файловое, что и у аттачей задач).
  readonly coverStorage: AttachmentStorage;
  // Лимит размера файла обложки в байтах.
  readonly maxCoverBytes: number;
};

// Project всегда содержит role (для текущего юзера). На list-эндпоинте role приходит
// из members.listProjectsForUser; на get/create/update — заполняем 'owner' как дефолт,
// потому что creator/updater сейчас всегда owner. После P3 (инвайты) get/update начнут
// возвращать реальную role через membership.
type ProjectDto = Omit<Project, 'createdAt'> & {
  createdAt: string;
  role: 'owner' | 'editor' | 'viewer';
  // Только на list-эндпоинте (приходят из ProjectWithRole); на get/create/update — undefined.
  memberCount?: number;
  taskCount?: number;
  // Персональный favorite-флаг + порядок в секции «Избранное» (см. db/040). На get/create/update
  // — undefined; на list — всегда заполнены (default false/0 на свежих membership'ах).
  isFavorite?: boolean;
  favoriteSortOrder?: number;
};

function toDto(project: ProjectWithRole | Project, fallbackRole: 'owner' | 'editor' | 'viewer' = 'owner'): ProjectDto {
  const role = 'role' in project ? project.role : fallbackRole;
  return { ...project, role, createdAt: project.createdAt.toISOString() };
}

type MemberDto = {
  projectId: string;
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
  };
};

function memberToDto(m: ProjectMemberWithUser): MemberDto {
  return {
    projectId: m.projectId,
    userId: m.userId,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
    user: {
      id: m.user.id,
      email: m.user.email,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
    },
  };
}


type CommitDto = Omit<GithubCommit, 'committedAt'> & { committedAt: string };

function commitToDto(c: GithubCommit): CommitDto {
  return { ...c, committedAt: c.committedAt.toISOString() };
}

export function projectsRouter(deps: Deps): Router {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.listProjects.execute(req.user!.id);
      res.json({ projects: list.map((p) => toDto(p)) });
    } catch (e) {
      next(e);
    }
  });

  // Персональная пересортировка проектов в сайдбаре. Регистрируем ДО '/:id', иначе
  // 'reorder' матчится как id.
  router.put('/reorder', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderedIds } = reorderProjectsSchema.parse(req.body);
      await deps.reorderProjects.execute({ userId: req.user!.id, orderedIds });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // Пересортировка проектов в секции «Избранное». Симметрично /reorder, но пишет
  // favorite_sort_order и только для favorites текущего юзера.
  router.put('/reorder-favorites', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderedIds } = reorderFavoritesSchema.parse(req.body);
      await deps.reorderFavoriteProjects.execute({ userId: req.user!.id, orderedIds });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // Git-collision: есть ли чужой проект с тем же репо. Регистрируем ДО '/:id', иначе
  // 'git-collision' матчится как id.
  router.get('/git-collision', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const url = typeof req.query['url'] === 'string' ? req.query['url'] : '';
      const result = await deps.checkGitCollision.execute(req.user!.id, url);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // Разрешение заявки на вступление (owner/admin). 3-сегментный путь — не клешится с '/:id'.
  router.post(
    '/join-requests/:requestId/resolve',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const requestId = req.params['requestId'];
        if (typeof requestId !== 'string') throw new ProjectNotFoundError();
        const accept = req.body?.accept === true;
        const result = await deps.resolveJoinRequest.execute(requestId, req.user!.id, accept);
        res.json(result);
      } catch (e) {
        next(e);
      }
    },
  );

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const project = await deps.getProject.execute(id, req.user!.id);
      if (!project) throw new ProjectNotFoundError();
      // Deep-link из другого пространства → делаем его активным (best-effort, не роняем ответ).
      try {
        await deps.setActiveWorkspaceForProject(req.user!.id, id);
      } catch {
        // авто-switch не критичен для отдачи проекта
      }
      // Реальная роль юзера в проекте, а не захардкоженный 'owner': иначе editor/viewer
      // по прямой ссылке видели бы danger zone. getProject уже подтвердил read-доступ, значит
      // membership есть; null возможен только для admin-bypass (не member) — ему отдаём 'owner'.
      const membership = await deps.members.findForProject(id, req.user!.id);
      res.json({ project: toDto(project, membership?.role ?? 'owner') });
    } catch (e) {
      next(e);
    }
  });

  // Персональная пометка проекта как favorite. Любой member может пометить (favorite —
  // персональная штука каждого юзера, не привилегия). Inbox — запрещён.
  router.put('/:id/favorite', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const { favorite } = toggleFavoriteSchema.parse(req.body);
      await deps.toggleProjectFavorite.execute({
        userId: req.user!.id,
        projectId: id,
        favorite,
      });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.get('/:id/commits', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const commits = await deps.listProjectCommits.execute(id, req.user!.id);
      res.json({ commits: commits.map(commitToDto) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createProjectSchema.parse(req.body);
      const project = await deps.createProject.execute({
        ownerId: req.user!.id,
        name: body.name,
      });
      res.status(201).json({ project: toDto(project) });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const body = updateProjectSchema.parse(req.body);
      const project = await deps.updateProject.execute({
        id,
        ownerId: req.user!.id,
        patch: body,
      });
      deps.notifyProjectChanged(id);
      res.json({ project: toDto(project) });
    } catch (e) {
      next(e);
    }
  });

  // === Публичная ссылка доски (Publish to web, db/096). Owner-only. ===
  // Публичная выдача самой доски — анонимный роутер /api/public/boards/:slug (отдельно,
  // без requireAuth). Здесь только управление публикацией из окна «Поделиться».
  router.post('/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const { slug } = await deps.publishProject.execute({ id, ownerId: req.user!.id });
      deps.notifyProjectChanged(id);
      res.json({ slug, url: publicBoardUrl(deps.appUrl, slug) });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      await deps.unpublishProject.execute({ id, ownerId: req.user!.id });
      deps.notifyProjectChanged(id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.patch('/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const { indexing } = setPublicIndexingSchema.parse(req.body);
      await deps.setPublicIndexing.execute({ id, ownerId: req.user!.id, indexing });
      deps.notifyProjectChanged(id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // === GitHub-репо приложения проекта (self-serve воркер-раннер, M1). Owner-only. ===
  // Создаёт (или возвращает существующий) репо под аккаунтом владельца. Требует привязанный GitHub.
  router.post('/:id/app-repo', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const { fullName } = await deps.ensureAppRepo.execute(id, req.user!.id);
      deps.notifyProjectChanged(id);
      res.json({ appRepoFullName: fullName });
    } catch (e) {
      next(e);
    }
  });

  // === Создать НОВЫЙ GitHub-репо и подключить к проекту (кнопка на «Обзоре»). ===
  // Репо создаётся под аккаунтом вызывающего его токеном. Editor+. 409 если уже подключён.
  router.post('/:id/repo', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const { name, privateRepo } = createProjectRepoSchema.parse(req.body);
      const result = await deps.createProjectRepo.execute(id, req.user!.id, { name, privateRepo });
      deps.notifyProjectChanged(id);
      res.json({ fullName: result.fullName, gitRepoUrl: result.gitRepoUrl });
    } catch (e) {
      next(e);
    }
  });

  // === Сайт-результат проекта (db/100 + db/098). Read (owner/member). siteSlug есть всегда:
  // до деплоя воркером по нему отдаётся заглушка, deployedAt=null. После деплоя — статика. ===
  router.get('/:id/site', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const site = await deps.getProjectSite.execute(id, req.user!.id);
      res.json({
        siteSlug: site.siteSlug,
        deployedAt: site.deployedAt ? site.deployedAt.toISOString() : null,
        fileCount: site.fileCount,
      });
    } catch (e) {
      next(e);
    }
  });

  // === Обложка проекта (Notion-style cover) ===
  // Загрузка своего файла: сохраняем в то же локальное хранилище, что и аттачи задач, и пишем
  // в project.coverUrl ссылку `/api/projects/:id/cover/<uuid>.<ext>` (отдаётся GET-ом ниже, с
  // проверкой доступа к проекту). Градиенты и внешние ссылки на картинку идут обычным PATCH.
  const COVER_EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  };
  const COVER_MIME: Record<string, string> = {
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
  };
  const coverUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxCoverBytes },
  });

  router.post('/:id/cover', coverUpload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const f = req.file;
      if (!f) {
        res.status(400).json({ error: 'Файл не передан' });
        return;
      }
      const ext = COVER_EXT[f.mimetype];
      if (!ext) {
        res.status(400).json({ error: 'Поддерживаются только jpg / png / webp / gif' });
        return;
      }
      await requireProjectAccess(
        { projects: deps.projects, members: deps.members },
        id,
        req.user!.id,
        'update_project',
      );
      const file = `${randomUUID()}.${ext}`;
      await deps.coverStorage.put({ storageKey: `covers/${id}/${file}`, data: f.buffer, mimeType: f.mimetype });
      const updated = await deps.projects.update(id, { coverUrl: `/api/projects/${id}/cover/${file}` });
      if (!updated) throw new ProjectNotFoundError();
      deps.notifyProjectChanged(id);
      res.json({ project: toDto(updated) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/:id/cover/:file', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      const file = req.params.file;
      // Только `<uuid>.<ext>` — защита от path-traversal и мусорных ключей.
      if (
        typeof id !== 'string' ||
        typeof file !== 'string' ||
        !/^[a-f0-9-]+\.(jpg|png|webp|gif|avif)$/i.test(file)
      ) {
        throw new ProjectNotFoundError();
      }
      await requireProjectAccess(
        { projects: deps.projects, members: deps.members },
        id,
        req.user!.id,
        'read_project',
      );
      const ext = file.split('.').pop()!.toLowerCase();
      const stored = await deps.coverStorage.read(`covers/${id}/${file}`);
      if (!stored) throw new ProjectNotFoundError();
      res.setHeader('Content-Type', COVER_MIME[ext] ?? 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.send(stored.data);
    } catch (e) {
      next(e);
    }
  });

  // Безвозвратное удаление проекта (owner-only через requireProjectAccess(...,'delete_project')).
  // Inbox запрещён (CannotDeleteInboxError → 400). Каскадит tasks/comments/commits/attachments-rows,
  // kb_documents, secrets, finance, invites, join_requests, members + сам проект. Файлы аттачей
  // best-effort чистит use-case fire-and-forget. GitHub-репо и github-KB-репо НЕ удаляются.
  // Оставшимся участникам — email-оповещение через notifier (fire-and-forget).
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const result = await deps.deleteProject.execute(id, req.user!.id);
      // Live-сигнал участникам, у кого открыт сайдбар: проект должен пропасть.
      // notifyProjectChanged — generic «что-то поменялось», в нашем случае удаление
      // вызовет 404 при попытке достать проект и UI его уберёт.
      deps.notifyProjectChanged(id);
      // Email-уведомления оставшимся (без актора).
      void deps.notifier
        .onProjectDeleted({
          projectName: result.project.name,
          actorUserId: req.user!.id,
          actorDisplayName: req.user!.displayName,
          recipients: result.memberSnapshots.map((m) => ({ userId: m.userId, email: m.user.email })),
        })
        .catch(() => {});
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // Notification prefs (свои) -------------------------------------------------
  // Доступ — быть участником проекта; каждый управляет только своими настройками.
  router.get(
    '/:id/notification-prefs',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        if (typeof id !== 'string') throw new ProjectNotFoundError();
        const membership = await deps.members.findForProject(id, req.user!.id);
        if (!membership) throw new ProjectNotFoundError();
        const prefs = await deps.members.getNotificationPrefs(id, req.user!.id);
        res.json({ prefs: prefs ?? {} });
      } catch (e) {
        next(e);
      }
    },
  );

  router.put(
    '/:id/notification-prefs',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        if (typeof id !== 'string') throw new ProjectNotFoundError();
        const membership = await deps.members.findForProject(id, req.user!.id);
        if (!membership) throw new ProjectNotFoundError();
        const prefs = notificationPrefsSchema.parse(req.body?.prefs ?? req.body);
        await deps.members.setNotificationPrefs(id, req.user!.id, prefs);
        res.json({ prefs });
      } catch (e) {
        next(e);
      }
    },
  );

  // Kanban settings (общие на проект) ----------------------------------------
  // Read — любой участник проекта. Write — editor+ (это shared-состояние доски,
  // viewer его менять не может). Цвета/переименования/скрытие колонок.
  router.get(
    '/:id/kanban-settings',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        if (typeof id !== 'string') throw new ProjectNotFoundError();
        const membership = await deps.members.findForProject(id, req.user!.id);
        if (!membership) throw new ProjectNotFoundError();
        const settings = await deps.projects.getKanbanSettings(id);
        res.json({ settings: settings ?? {} });
      } catch (e) {
        next(e);
      }
    },
  );

  router.put(
    '/:id/kanban-settings',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        if (typeof id !== 'string') throw new ProjectNotFoundError();
        const membership = await deps.members.findForProject(id, req.user!.id);
        if (!membership) throw new ProjectNotFoundError();
        if (membership.role === 'viewer') {
          res.status(403).json({ error: 'Недостаточно прав для изменения настроек доски' });
          return;
        }
        const settings = kanbanSettingsSchema.parse(req.body?.settings ?? req.body);
        await deps.projects.setKanbanSettings(id, settings);
        // Доска — shared: сигналим остальным участникам, чтобы их вкладки перечитали настройки.
        deps.notifyProjectChanged(id);
        res.json({ settings });
      } catch (e) {
        next(e);
      }
    },
  );

  // Вью доски (Notion-style, db/103) ---------------------------------------
  // Read — любой участник проекта; create/rename/duplicate/delete — editor+ (shared-
  // состояние доски, как kanban-settings). Дефолтная вкладка «Доска» — неявная (клиент),
  // в БД только пользовательские вью.
  const viewToDto = (v: BoardView): Record<string, unknown> => ({
    id: v.id,
    projectId: v.projectId,
    name: v.name,
    type: v.type,
    sortOrder: v.sortOrder,
    config: v.config,
    createdAt: v.createdAt.toISOString(),
  });
  // Гейт мутаций: участник и не viewer. Возвращает membership или null (ответ уже отправлен).
  const requireViewEditor = async (
    projectId: string,
    userId: string,
    res: Response,
  ): Promise<boolean> => {
    const membership = await deps.members.findForProject(projectId, userId);
    if (!membership) throw new ProjectNotFoundError();
    if (membership.role === 'viewer') {
      res.status(403).json({ error: 'Недостаточно прав для изменения вью доски' });
      return false;
    }
    return true;
  };

  router.get('/:id/views', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const membership = await deps.members.findForProject(id, req.user!.id);
      if (!membership) throw new ProjectNotFoundError();
      const views = await deps.boardViews.listForProject(id);
      res.json({ views: views.map(viewToDto) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/views', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      if (!(await requireViewEditor(id, req.user!.id, res))) return;
      const body = createBoardViewSchema.parse(req.body);
      const view = await deps.boardViews.create({
        id: randomUUID(),
        projectId: id,
        name: body.name,
        type: body.type,
        createdBy: req.user!.id,
      });
      deps.notifyProjectChanged(id);
      res.status(201).json({ view: viewToDto(view) });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/:id/views/:viewId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      const viewId = req.params['viewId'];
      if (typeof id !== 'string' || typeof viewId !== 'string') throw new ProjectNotFoundError();
      if (!(await requireViewEditor(id, req.user!.id, res))) return;
      const body = updateBoardViewSchema.parse(req.body);
      // Принадлежность вью проекту из URL — иначе id из чужого проекта был бы IDOR.
      const existing = await deps.boardViews.getById(viewId);
      if (!existing || existing.projectId !== id) throw new ProjectNotFoundError();
      const view = await deps.boardViews.update(viewId, body);
      if (!view) throw new ProjectNotFoundError();
      deps.notifyProjectChanged(id);
      res.json({ view: viewToDto(view) });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/:id/views/:viewId/duplicate',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const viewId = req.params['viewId'];
        if (typeof id !== 'string' || typeof viewId !== 'string') throw new ProjectNotFoundError();
        if (!(await requireViewEditor(id, req.user!.id, res))) return;
        const existing = await deps.boardViews.getById(viewId);
        if (!existing || existing.projectId !== id) throw new ProjectNotFoundError();
        // «Имя (копия)» с обрезкой под лимит колонки. Конфиг (фильтры/колонки/…) копируется.
        const name = `${existing.name} (копия)`.slice(0, 64);
        let view = await deps.boardViews.create({
          id: randomUUID(),
          projectId: id,
          name,
          type: existing.type,
          createdBy: req.user!.id,
        });
        if (existing.config) {
          view = (await deps.boardViews.update(view.id, { config: existing.config })) ?? view;
        }
        deps.notifyProjectChanged(id);
        res.status(201).json({ view: viewToDto(view) });
      } catch (e) {
        next(e);
      }
    },
  );

  router.delete('/:id/views/:viewId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      const viewId = req.params['viewId'];
      if (typeof id !== 'string' || typeof viewId !== 'string') throw new ProjectNotFoundError();
      if (!(await requireViewEditor(id, req.user!.id, res))) return;
      const existing = await deps.boardViews.getById(viewId);
      if (!existing || existing.projectId !== id) throw new ProjectNotFoundError();
      await deps.boardViews.delete(viewId);
      deps.notifyProjectChanged(id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // Шаблоны задач (Notion Templates, db/108) --------------------------------
  // Read — участник; create/delete — editor+ (реюз requireViewEditor).
  const templateToDto = (t: TaskTemplate): Record<string, unknown> => ({
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    description: t.description,
    status: t.status,
    priority: t.priority,
    icon: t.icon,
    createdAt: t.createdAt.toISOString(),
  });

  router.get('/:id/templates', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const membership = await deps.members.findForProject(id, req.user!.id);
      if (!membership) throw new ProjectNotFoundError();
      const templates = await deps.taskTemplates.listForProject(id);
      res.json({ templates: templates.map(templateToDto) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/templates', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      if (!(await requireViewEditor(id, req.user!.id, res))) return;
      const body = createTaskTemplateSchema.parse(req.body);
      const template = await deps.taskTemplates.create({
        id: randomUUID(),
        projectId: id,
        name: body.name,
        description: body.description,
        status: body.status ?? 'backlog',
        priority: body.priority ?? null,
        icon: body.icon ?? null,
        createdBy: req.user!.id,
      });
      deps.notifyProjectChanged(id);
      res.status(201).json({ template: templateToDto(template) });
    } catch (e) {
      next(e);
    }
  });

  router.delete(
    '/:id/templates/:templateId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const templateId = req.params['templateId'];
        if (typeof id !== 'string' || typeof templateId !== 'string')
          throw new ProjectNotFoundError();
        if (!(await requireViewEditor(id, req.user!.id, res))) return;
        // Принадлежность проекту из URL — иначе IDOR.
        const existing = await deps.taskTemplates.getById(templateId);
        if (!existing || existing.projectId !== id) throw new ProjectNotFoundError();
        await deps.taskTemplates.delete(templateId);
        deps.notifyProjectChanged(id);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  // Кастомные свойства задач (Notion custom properties, db/109) -------------
  // Read — участник; мутации — editor+ (реюз requireViewEditor).
  const propertyToDto = (p: TaskProperty): Record<string, unknown> => ({
    id: p.id,
    projectId: p.projectId,
    name: p.name,
    type: p.type,
    options: p.options,
    position: p.position,
  });

  router.get('/:id/properties', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const membership = await deps.members.findForProject(id, req.user!.id);
      if (!membership) throw new ProjectNotFoundError();
      const properties = await deps.taskProperties.listForProject(id);
      const values = await deps.taskProperties.listValuesForProject(id);
      res.json({ properties: properties.map(propertyToDto), values });
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/properties', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      if (!(await requireViewEditor(id, req.user!.id, res))) return;
      const body = createTaskPropertySchema.parse(req.body);
      const property = await deps.taskProperties.create({
        id: randomUUID(),
        projectId: id,
        name: body.name,
        type: body.type,
        options: body.options ?? [],
      });
      deps.notifyProjectChanged(id);
      res.status(201).json({ property: propertyToDto(property) });
    } catch (e) {
      next(e);
    }
  });

  router.patch(
    '/:id/properties/:propertyId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const propertyId = req.params['propertyId'];
        if (typeof id !== 'string' || typeof propertyId !== 'string')
          throw new ProjectNotFoundError();
        if (!(await requireViewEditor(id, req.user!.id, res))) return;
        // Принадлежность проекту из URL — иначе IDOR.
        const existing = await deps.taskProperties.getById(propertyId);
        if (!existing || existing.projectId !== id) throw new ProjectNotFoundError();
        const body = updateTaskPropertySchema.parse(req.body);
        const updated = await deps.taskProperties.update(propertyId, body);
        if (!updated) throw new ProjectNotFoundError();
        deps.notifyProjectChanged(id);
        res.json({ property: propertyToDto(updated) });
      } catch (e) {
        next(e);
      }
    },
  );

  router.delete(
    '/:id/properties/:propertyId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const propertyId = req.params['propertyId'];
        if (typeof id !== 'string' || typeof propertyId !== 'string')
          throw new ProjectNotFoundError();
        if (!(await requireViewEditor(id, req.user!.id, res))) return;
        const existing = await deps.taskProperties.getById(propertyId);
        if (!existing || existing.projectId !== id) throw new ProjectNotFoundError();
        await deps.taskProperties.delete(propertyId);
        deps.notifyProjectChanged(id);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  // Значение свойства у задачи (upsert). Editor+; задача и свойство — из проекта URL.
  router.put(
    '/:id/tasks/:taskId/properties/:propertyId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const taskId = req.params['taskId'];
        const propertyId = req.params['propertyId'];
        if (
          typeof id !== 'string' ||
          typeof taskId !== 'string' ||
          typeof propertyId !== 'string'
        )
          throw new ProjectNotFoundError();
        if (!(await requireViewEditor(id, req.user!.id, res))) return;
        const property = await deps.taskProperties.getById(propertyId);
        if (!property || property.projectId !== id) throw new ProjectNotFoundError();
        const task = await deps.tasks.getById(taskId);
        if (!task || task.projectId !== id) throw new ProjectNotFoundError();
        const body = setTaskPropertyValueSchema.parse(req.body);
        await deps.taskProperties.setValue(taskId, propertyId, body.value);
        await deps.taskVersions.record(task, req.user!.id, task, ['customProperties']);
        deps.notifyProjectChanged(id);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  // Members ---------------------------------------------------------------
  router.get('/:id/members', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const list = await deps.listMembers.execute(id, req.user!.id);
      res.json({ members: list.map(memberToDto) });
    } catch (e) {
      next(e);
    }
  });

  // Управление составом команды (смена роли/удаление участника/передача владения)
  // переехало на уровень пространства — см. /api/workspaces/:id/members/*
  // (WorkspaceService). Роуты PATCH/DELETE /:id/members/:userId и POST /:id/transfer
  // отсюда удалены (Concern B code review): доступ к проекту читается только из
  // workspace_members (unified-workspace §3.2), а эти роуты мутировали лишь легаси
  // project_members-кеш — возвращали success и слали команде уведомления об
  // изменении, реально ни на что не влияя.

  // Ralph-диспетчер -------------------------------------------------------
  // Список кандидатов в диспетчеры (участники с ≥1 активным agent-токеном). viewer+.
  router.get('/:id/dispatcher-candidates', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const candidates = await deps.listDispatcherCandidates.execute(id, req.user!.id);
      res.json({ candidates });
    } catch (e) {
      next(e);
    }
  });

  // Назначить / снять диспетчера. owner-only.
  router.put('/:id/dispatcher', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const body = setDispatcherSchema.parse(req.body);
      const project = await deps.setProjectDispatcher.execute(
        id,
        req.user!.id,
        body.userId,
      );
      deps.notifyProjectChanged(id);
      res.json({ project: toDto(project, 'owner') });
    } catch (e) {
      next(e);
    }
  });

  // Включить / выключить «Мультизадачный воркер» (параллельное выполнение задач проекта
  // диспетчером). Любой участник (viewer+ — проверка роли внутри SetProjectMultiTaskWorker).
  router.put('/:id/multi-task-worker', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const body = setMultiTaskWorkerSchema.parse(req.body);
      const project = await deps.setMultiTaskWorker.execute(id, req.user!.id, body.enabled);
      deps.notifyProjectChanged(id);
      res.json({ project: toDto(project) });
    } catch (e) {
      next(e);
    }
  });

  // === Git-token delegation ===
  // v0.15: per-member opt-in.
  // Возвращает:
  //   - `mine`: статус делегации САМОГО caller'а в этом проекте (null если caller
  //     не member или ни разу не настраивал).
  //   - `all`: полный список членов с их статусами — ТОЛЬКО для owner проекта
  //     (privacy: остальные видят только свой). Для не-owner'а массив пустой.
  //     Сортировка: owner первым, затем по displayName ASC (та же логика, что в
  //     GetDelegatedGitToken — UI рисует «кто будет выбран первым»).
  router.get(
    '/:id/git-token-delegation',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        if (typeof id !== 'string') throw new ProjectNotFoundError();
        const callerId = req.user!.id;

        const project = await deps.projects.getById(id);
        if (!project) throw new ProjectNotFoundError();

        // Caller's own delegation. Возвращаем null если не member ИЛИ записи нет.
        const callerMembership = await deps.members.findForProject(id, callerId);
        let mine: { enabled: boolean; grantedAt: string | null; revokedAt: string | null } | null = null;
        if (callerMembership) {
          const own = await deps.gitTokenDelegations.getForMember(id, callerId);
          mine = own
            ? {
                enabled: own.enabled,
                grantedAt: own.grantedAt ? own.grantedAt.toISOString() : null,
                revokedAt: own.revokedAt ? own.revokedAt.toISOString() : null,
              }
            : { enabled: false, grantedAt: null, revokedAt: null };
        }

        // Privacy: `all` отдаём только owner'у. Остальные — пустой массив.
        const isOwner = callerMembership?.role === 'owner';
        let all: Array<{
          granterUserId: string;
          displayName: string;
          githubLogin: string | null;
          enabled: boolean;
          grantedAt: string | null;
          revokedAt: string | null;
          isOwner: boolean;
        }> = [];

        if (isOwner) {
          // Все members проекта (с user-данными) + все делегации + GH-логины
          // одной пачкой. На проекте обычно ≤10 членов — N+1 на github-login
          // приемлем.
          const members = await deps.members.listByProject(id);
          const allDelegations = await deps.gitTokenDelegations.listAllForProject(id);
          const delegationByMember = new Map(allDelegations.map((d) => [d.granterUserId, d]));

          const ghLogins = await Promise.all(
            members.map(async (m) => {
              const conn = await deps.githubTokens.getByUserId(m.userId);
              return { userId: m.userId, login: conn?.githubLogin ?? null };
            }),
          );
          const loginByUser = new Map(ghLogins.map((g) => [g.userId, g.login]));

          // Сортировка: owner первым, остальные по displayName ASC, при равенстве email.
          const sorted = [...members].sort((a, b) => {
            if (a.userId === project.ownerId) return -1;
            if (b.userId === project.ownerId) return 1;
            const c = a.user.displayName.toLowerCase().localeCompare(b.user.displayName.toLowerCase(), 'ru');
            if (c !== 0) return c;
            return a.user.email.localeCompare(b.user.email);
          });

          all = sorted.map((m) => {
            const d = delegationByMember.get(m.userId);
            return {
              granterUserId: m.userId,
              displayName: m.user.displayName,
              githubLogin: loginByUser.get(m.userId) ?? null,
              enabled: d?.enabled ?? false,
              grantedAt: d?.grantedAt ? d.grantedAt.toISOString() : null,
              revokedAt: d?.revokedAt ? d.revokedAt.toISOString() : null,
              isOwner: m.userId === project.ownerId,
            };
          });
        }

        res.json({ mine, all });
      } catch (e) {
        next(e);
      }
    },
  );

  // Включить/выключить ОДНУ делегацию. Без granterUserId — caller включает СВОЮ.
  // С granterUserId — admin-on-behalf (use-case проверяет isAdmin).
  router.put(
    '/:id/git-token-delegation',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        if (typeof id !== 'string') throw new ProjectNotFoundError();
        const body = setGitTokenDelegationSchema.parse(req.body);
        const delegation = await deps.setGitTokenDelegation.execute({
          projectId: id,
          callerUserId: req.user!.id,
          enabled: body.enabled,
          granterUserId: body.granterUserId,
        });
        res.json({
          enabled: delegation.enabled,
          grantedAt: delegation.grantedAt ? delegation.grantedAt.toISOString() : null,
          revokedAt: delegation.revokedAt ? delegation.revokedAt.toISOString() : null,
          granterUserId: delegation.granterUserId,
        });
      } catch (e) {
        next(e);
      }
    },
  );

  // Лог обращений к токену. Owner-only (use-case проверяет). Резолвим displayName
  // юзеров одним batch-fetch'ем для UI «кто и когда брал».
  router.get(
    '/:id/git-token-delegation/access-log',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        if (typeof id !== 'string') throw new ProjectNotFoundError();
        const entries = await deps.listGitTokenAccessLog.execute(id, req.user!.id, 50);
        const userIds = [...new Set(entries.map((e) => e.accessedByUserId))];
        const usersMap = new Map(
          (await deps.users.getManyByIds(userIds)).map((u) => [u.id, u]),
        );
        res.json({
          entries: entries.map((e) => ({
            accessedByUserId: e.accessedByUserId,
            accessedByDisplayName: usersMap.get(e.accessedByUserId)?.displayName ?? null,
            accessedAt: e.accessedAt.toISOString(),
            outcome: e.outcome,
            context: e.context,
          })),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  // Join-requests: заявитель просится в проект (по совпадению git-репо).
  router.post('/:id/join-requests', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const result = await deps.requestJoin.execute(req.user!.id, id);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
