import { Router, type Request, type Response, type NextFunction } from 'express';
import type { WorkspaceService } from '../../application/workspace/WorkspaceService.js';
import type { Workspace, WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type { WorkspaceListItem } from '../../application/workspace/WorkspaceRepository.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import type { CreateWorkspaceInvite } from '../../application/workspace/CreateWorkspaceInvite.js';
import type { ListWorkspaceInvites } from '../../application/workspace/ListWorkspaceInvites.js';
import type { DeleteWorkspaceInvite } from '../../application/workspace/DeleteWorkspaceInvite.js';
import type { ManageWorkspaceAssigneeDigest } from '../../application/digest/ManageWorkspaceAssigneeDigest.js';
import type { BulkSetWorkspaceCommitSync } from '../../application/commit-sync/BulkSetWorkspaceCommitSync.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { z } from 'zod';
import {
  addMemberSchema,
  changeRoleSchema,
  createWorkspaceInviteSchema,
  createWorkspaceSchema,
  moveProjectSchema,
  resolveWorkspaceTelegramGroupSchema,
  saveWorkspaceAssigneeDigestSchema,
  setCurrentSchema,
  updateWorkspaceSchema,
} from './schemas.js';

// Мастер-действие «включить сверку коммитов по всем проектам пространства».
const bulkCommitSyncSchema = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23).default(17),
  minute: z.number().int().min(0).max(59).default(0),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([0, 1, 2, 3, 4, 5, 6]),
  // Режим сверки: 'auto' — переносить задачи, 'propose' — только оповещать.
  action: z.enum(['propose', 'auto']).default('propose'),
});

type WorkspaceDto = {
  id: string;
  name: string;
  icon: string | null;
  kind: WorkspaceKind;
  ownerUserId: string;
  role?: WorkspaceRole;
  projectCount?: number;
  memberCount?: number;
  isCurrent?: boolean;
  createdAt: string;
};

function toDto(ws: Workspace): WorkspaceDto;
function toDto(ws: WorkspaceListItem, isCurrent: boolean): WorkspaceDto;
function toDto(ws: Workspace | WorkspaceListItem, isCurrent?: boolean): WorkspaceDto {
  const listItem = ws as Partial<WorkspaceListItem>;
  return {
    id: ws.id,
    name: ws.name,
    icon: ws.icon,
    kind: ws.kind,
    ownerUserId: ws.ownerUserId,
    role: listItem.role,
    projectCount: listItem.projectCount,
    memberCount: listItem.memberCount,
    isCurrent,
    createdAt: ws.createdAt.toISOString(),
  };
}

function memberToDto(m: WorkspaceMember): {
  userId: string;
  role: WorkspaceRole;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
} {
  return {
    userId: m.userId,
    role: m.role,
    displayName: m.displayName ?? null,
    email: m.email ?? null,
    avatarUrl: m.avatarUrl ?? null,
  };
}

// Полная форма — зеркало InviteDto из projects/routes.ts (эррата #3): клиент объявит
// домен WorkspaceInviteDto с этими полями. token/url — только в ответе на create.
type WorkspaceInviteDto = {
  id: string;
  workspaceId: string;
  role: 'editor' | 'viewer';
  email: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  createdByUserId: string;
  createdAt: string;
  token?: string;
  url?: string;
};

function inviteToDto(
  i: WorkspaceInvite,
  opts?: { includeToken?: boolean; appUrl?: string },
): WorkspaceInviteDto {
  const dto: WorkspaceInviteDto = {
    id: i.id,
    workspaceId: i.workspaceId,
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

type Deps = {
  readonly service: WorkspaceService;
  readonly invites: {
    readonly create: CreateWorkspaceInvite;
    readonly list: ListWorkspaceInvites;
    readonly delete: DeleteWorkspaceInvite;
  };
  readonly assigneeDigest: ManageWorkspaceAssigneeDigest;
  readonly bulkCommitSync: BulkSetWorkspaceCommitSync;
  readonly appUrl: string;
};

export function workspacesRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  // GET /api/workspaces — мои пространства, активное помечено isCurrent.
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const [list, current] = await Promise.all([
        deps.service.listForUser(userId),
        deps.service.getCurrentWorkspaceId(userId),
      ]);
      // Если current обнулился (после удаления) — считаем активным первое в списке.
      const currentId = current ?? list[0]?.id ?? null;
      res.json({ workspaces: list.map((w) => toDto(w, w.id === currentId)) });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/workspaces — создать + сделать активным.
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createWorkspaceSchema.parse(req.body);
      const ws = await deps.service.create(req.user!.id, { name: body.name, icon: body.icon ?? null });
      res.status(201).json({ workspace: toDto(ws) });
    } catch (e) {
      next(e);
    }
  });

  // PUT /api/workspaces/current — сменить активное.
  router.put('/current', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = setCurrentSchema.parse(req.body);
      await deps.service.switchCurrent(req.user!.id, body.workspaceId);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // PATCH /api/workspaces/:id — переименовать / сменить иконку.
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateWorkspaceSchema.parse(req.body);
      const ws = await deps.service.rename(req.params.id as string, req.user!.id, body);
      res.json({ workspace: toDto(ws) });
    } catch (e) {
      next(e);
    }
  });

  // DELETE /api/workspaces/:id — удалить пространство.
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.service.deleteWorkspace(req.params.id as string, req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // GET /api/workspaces/:id/members
  router.get('/:id/members', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const members = await deps.service.listMembers(req.params.id as string, req.user!.id);
      res.json({ members: members.map(memberToDto) });
    } catch (e) {
      next(e);
    }
  });

  router.get(
    '/:id/assignee-digest',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await deps.assigneeDigest.get(
          req.params.id as string,
          req.user!.id,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/:id/assignee-digest',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = saveWorkspaceAssigneeDigestSchema.parse(req.body);
        const settings = await deps.assigneeDigest.save(
          req.params.id as string,
          req.user!.id,
          body,
        );
        res.json({ settings });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:id/assignee-digest/send-now',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await deps.assigneeDigest.sendNow(
          req.params.id as string,
          req.user!.id,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // POST /:id/commit-sync/apply-all — включить/выключить сверку коммитов во ВСЕХ проектах
  // пространства разом + задать время и дни. Каждый проект дальше гоняется своим расписанием.
  router.post(
    '/:id/commit-sync/apply-all',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = bulkCommitSyncSchema.parse(req.body);
        const result = await deps.bulkCommitSync.execute(
          req.params.id as string,
          req.user!.id,
          body,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:id/assignee-digest/groups',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const groups = await deps.assigneeDigest.listGroups(
          req.params.id as string,
          req.user!.id,
        );
        res.json({ groups });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:id/assignee-digest/group/resolve',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = resolveWorkspaceTelegramGroupSchema.parse(req.body);
        const result = await deps.assigneeDigest.resolveGroupTitle(
          req.params.id as string,
          req.user!.id,
          body.chatId,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // POST /api/workspaces/:id/members — добавить участника по email.
  router.post('/:id/members', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = addMemberSchema.parse(req.body);
      const m = await deps.service.addMember(req.params.id as string, req.user!.id, body.email, body.role ?? 'editor');
      res.status(201).json({ member: memberToDto(m) });
    } catch (e) {
      next(e);
    }
  });

  // PATCH /api/workspaces/:id/members/:userId — сменить роль.
  router.patch('/:id/members/:userId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = changeRoleSchema.parse(req.body);
      await deps.service.changeMemberRole(req.params.id as string, req.user!.id, req.params.userId as string, body.role);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // DELETE /api/workspaces/:id/members/:userId — удалить участника.
  router.delete('/:id/members/:userId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.service.removeMember(req.params.id as string, req.user!.id, req.params.userId as string);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // GET /api/workspaces/:id/projects — проекты пространства.
  router.get('/:id/projects', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projects = await deps.service.listProjects(req.params.id as string, req.user!.id);
      res.json({ projects });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/workspaces/:id/projects/:projectId/move — перенести проект в другое пространство.
  router.post('/:id/projects/:projectId/move', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = moveProjectSchema.parse(req.body);
      await deps.service.moveProject(req.params.id as string, req.user!.id, req.params.projectId as string, body.targetWorkspaceId);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // GET /api/workspaces/:id/invites — pending-инвайты (owner/editor). Token не отдаём.
  router.get('/:id/invites', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.invites.list.execute(req.params.id as string, req.user!.id);
      res.json({ invites: list.map((i) => inviteToDto(i)) });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/workspaces/:id/invites — создать invite; token+url только в этом ответе.
  router.post('/:id/invites', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createWorkspaceInviteSchema.parse(req.body);
      const { invite } = await deps.invites.create.execute({
        workspaceId: req.params.id as string,
        actorUserId: req.user!.id,
        role: body.role,
        email: body.email,
      });
      res.status(201).json({
        invite: inviteToDto(invite, { includeToken: true, appUrl: deps.appUrl }),
      });
    } catch (e) {
      next(e);
    }
  });

  // DELETE /api/workspaces/:id/invites/:inviteId — отозвать invite.
  router.delete(
    '/:id/invites/:inviteId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await deps.invites.delete.execute(
          req.params.id as string,
          req.user!.id,
          req.params['inviteId'] as string,
        );
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
