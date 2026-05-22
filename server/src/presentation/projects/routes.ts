import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ListProjects, ProjectWithRole } from '../../application/project/ListProjects.js';
import type { GetProject } from '../../application/project/GetProject.js';
import type { CreateProject } from '../../application/project/CreateProject.js';
import type { UpdateProject } from '../../application/project/UpdateProject.js';
import type { ReorderProjects } from '../../application/project/ReorderProjects.js';
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
import type { ProjectMemberWithUser } from '../../application/project/ProjectMemberRepository.js';
import type { ListProjectCommits } from '../../application/github/ListProjectCommits.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectInvite } from '../../domain/project/ProjectInvite.js';
import type { GithubCommit } from '../../domain/github/GithubConnection.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  createInviteSchema,
  createProjectSchema,
  reorderProjectsSchema,
  transferOwnershipSchema,
  updateMemberRoleSchema,
  updateProjectSchema,
} from './schemas.js';

type Deps = {
  readonly listProjects: ListProjects;
  readonly getProject: GetProject;
  readonly createProject: CreateProject;
  readonly updateProject: UpdateProject;
  readonly reorderProjects: ReorderProjects;
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
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

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
