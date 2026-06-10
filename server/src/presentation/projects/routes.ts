import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ListProjects, ProjectWithRole } from '../../application/project/ListProjects.js';
import type { GetProject } from '../../application/project/GetProject.js';
import type { CreateProject } from '../../application/project/CreateProject.js';
import type { UpdateProject } from '../../application/project/UpdateProject.js';
import type { DeleteProject } from '../../application/project/DeleteProject.js';
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
import type { RemoveProjectMember } from '../../application/project/RemoveProjectMember.js';
import type { UpdateProjectMemberRole } from '../../application/project/UpdateProjectMemberRole.js';
import type { TransferProjectOwnership } from '../../application/project/TransferProjectOwnership.js';
import type { CreateProjectInvite } from '../../application/project/CreateProjectInvite.js';
import type { ListProjectInvites } from '../../application/project/ListProjectInvites.js';
import type { DeleteProjectInvite } from '../../application/project/DeleteProjectInvite.js';
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
import type { ProjectInvite } from '../../domain/project/ProjectInvite.js';
import type { GithubCommit } from '../../domain/github/GithubConnection.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  createInviteSchema,
  createProjectSchema,
  kanbanSettingsSchema,
  notificationPrefsSchema,
  reorderFavoritesSchema,
  reorderProjectsSchema,
  setDispatcherSchema,
  setMultiTaskWorkerSchema,
  setGitTokenDelegationSchema,
  toggleFavoriteSchema,
  transferOwnershipSchema,
  updateMemberRoleSchema,
  updateProjectSchema,
} from './schemas.js';

type Deps = {
  readonly listProjects: ListProjects;
  readonly getProject: GetProject;
  readonly createProject: CreateProject;
  readonly updateProject: UpdateProject;
  readonly deleteProject: DeleteProject;
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
  readonly reorderProjects: ReorderProjects;
  readonly toggleProjectFavorite: ToggleProjectFavorite;
  readonly reorderFavoriteProjects: ReorderFavoriteProjects;
  readonly listProjectCommits: ListProjectCommits;
  readonly listMembers: ListProjectMembers;
  readonly removeMember: RemoveProjectMember;
  readonly updateMemberRole: UpdateProjectMemberRole;
  readonly transferOwnership: TransferProjectOwnership;
  readonly createInvite: CreateProjectInvite;
  readonly listInvites: ListProjectInvites;
  readonly deleteInvite: DeleteProjectInvite;
  readonly checkGitCollision: CheckGitCollision;
  readonly requestJoin: RequestProjectJoin;
  readonly resolveJoinRequest: ResolveProjectJoinRequest;
  // Базовый URL приложения — нужен для формирования invite-URL'а в ответе на создание.
  readonly appUrl: string;
  // Live-обновление: сигнал «проект изменился» всем участникам (SSE). Best-effort.
  readonly notifyProjectChanged: (projectId: string) => void;
  // Email-оповещения команде (изменения состава) + чтение/запись пер-участниковых настроек.
  readonly notifier: ProjectNotificationService;
  readonly members: ProjectMemberRepository;
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

type InviteDto = {
  id: string;
  projectId: string;
  role: 'editor' | 'viewer';
  email: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  createdByUserId: string;
  createdAt: string;
  // Сам token приходит только в ответе на создание (см. invite-маршрут);
  // listInvites его не отдаёт — он одноразовый секрет.
  token?: string;
  url?: string;
};

function inviteToDto(i: ProjectInvite, opts?: { includeToken?: boolean; appUrl?: string }): InviteDto {
  const dto: InviteDto = {
    id: i.id,
    projectId: i.projectId,
    role: i.role,
    email: i.email,
    expiresAt: i.expiresAt.toISOString(),
    acceptedAt: i.acceptedAt?.toISOString() ?? null,
    acceptedByUserId: i.acceptedByUserId,
    createdByUserId: i.createdByUserId,
    createdAt: i.createdAt.toISOString(),
  };
  if (opts?.includeToken) {
    dto.token = i.token;
    if (opts.appUrl) dto.url = `${opts.appUrl.replace(/\/$/, '')}/invite/${i.token}`;
  }
  return dto;
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
      res.json({ project: toDto(project) });
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

  router.patch(
    '/:id/members/:userId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const userId = req.params['userId'];
        if (typeof id !== 'string' || typeof userId !== 'string') throw new ProjectNotFoundError();
        const body = updateMemberRoleSchema.parse(req.body);
        const updated = await deps.updateMemberRole.execute({
          projectId: id,
          actorUserId: req.user!.id,
          targetUserId: userId,
          role: body.role,
        });
        void deps.notifier
          .onMemberChanged(id, req.user!.id, `изменил роль участника на «${body.role}»`, 'team')
          .catch(() => {});
        res.json({
          membership: {
            projectId: updated.projectId,
            userId: updated.userId,
            role: updated.role,
            joinedAt: updated.joinedAt.toISOString(),
          },
        });
      } catch (e) {
        next(e);
      }
    },
  );

  router.delete(
    '/:id/members/:userId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const userId = req.params['userId'];
        if (typeof id !== 'string' || typeof userId !== 'string') throw new ProjectNotFoundError();
        await deps.removeMember.execute(id, req.user!.id, userId);
        // Оставшимся участникам — email «изменение в команде» (fire-and-forget).
        void deps.notifier
          .onMemberChanged(id, req.user!.id, 'удалил участника из проекта', 'team')
          .catch(() => {});
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  router.post('/:id/transfer', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const body = transferOwnershipSchema.parse(req.body);
      await deps.transferOwnership.execute({
        projectId: id,
        actorUserId: req.user!.id,
        toUserId: body.toUserId,
      });
      void deps.notifier
        .onMemberChanged(id, req.user!.id, 'передал владение проектом', 'team')
        .catch(() => {});
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

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

  // Invites ---------------------------------------------------------------
  router.get('/:id/invites', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const list = await deps.listInvites.execute(id, req.user!.id);
      // listInvites — для owner-UI, token не отдаём (одноразовый секрет; см. spec секцию 10).
      res.json({ invites: list.map((i) => inviteToDto(i)) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/invites', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const body = createInviteSchema.parse(req.body);
      const { invite } = await deps.createInvite.execute({
        projectId: id,
        actorUserId: req.user!.id,
        role: body.role,
        email: body.email ?? null,
      });
      // В ответ на create отдаём token + готовый URL — больше нигде эта инфа не доступна.
      res.status(201).json({
        invite: inviteToDto(invite, { includeToken: true, appUrl: deps.appUrl }),
      });
    } catch (e) {
      next(e);
    }
  });

  router.delete(
    '/:id/invites/:inviteId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const inviteId = req.params['inviteId'];
        if (typeof id !== 'string' || typeof inviteId !== 'string') throw new ProjectNotFoundError();
        await deps.deleteInvite.execute(id, req.user!.id, inviteId);
        res.status(204).end();
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
