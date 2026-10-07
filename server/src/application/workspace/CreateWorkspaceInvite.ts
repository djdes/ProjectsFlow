import type {
  WorkspaceInvite,
  WorkspaceInviteRole,
} from '../../domain/workspace/WorkspaceInvite.js';
import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';
import {
  WorkspaceNotFoundError,
  CannotInviteToDefaultWorkspaceError,
  WorkspaceInviteMemberExistsError,
} from '../../domain/workspace/errors.js';
import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import { requireWorkspaceEditor, requireWorkspaceLead } from './workspaceAccess.js';
import type { WorkspaceProjectAccessRepository } from './WorkspaceProjectAccessRepository.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';

// Узкие структурные порты — реальные репозитории (DrizzleWorkspaceRepository,
// DrizzleUserRepository) им соответствуют.
type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  getById(id: string): Promise<{ id: string; name: string; kind: WorkspaceKind } | null>;
};
type UsersPort = {
  getById(id: string): Promise<{ displayName: string } | null>;
  getByEmail(email: string): Promise<{ id: string } | null>;
};
type Deps = {
  readonly workspaces: WorkspacesPort;
  readonly invites: WorkspaceInviteRepository;
  readonly users: UsersPort;
  readonly onQueued?: () => void;
  readonly idGen: () => string;
  readonly randomToken: () => string;
  readonly now: () => Date;
  readonly ttlMs: number;
  readonly projectAccess?: Pick<WorkspaceProjectAccessRepository, 'listProjects' | 'listExclusions'>;
};

export type CreateWorkspaceInviteCommand = {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly role: WorkspaceInviteRole;
  // Информационный email — mismatch при accept разрешён (как у project-инвайтов).
  readonly email: string | null;
  readonly excludedProjectIds?: readonly string[];
};

export class CreateWorkspaceInvite {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateWorkspaceInviteCommand): Promise<{ invite: WorkspaceInvite; reused: boolean; canShare: boolean }> {
    // Приглашать могут owner, lead и editor; viewer — нет.
    const actor = await requireWorkspaceEditor(this.deps.workspaces, input.workspaceId, input.actorUserId);
    const ws = await this.deps.workspaces.getById(input.workspaceId);
    if (!ws) throw new WorkspaceNotFoundError();
    // Личный дефолт-хаб — авто-управляемая агрегирующая вьюха, не контейнер с общими
    // участниками. Приглашать в него нельзя (см. CannotInviteToDefaultWorkspaceError).
    if (ws.kind === 'default') throw new CannotInviteToDefaultWorkspaceError();

    const excludedProjectIds = [...new Set(input.excludedProjectIds ?? [])];
    if (excludedProjectIds.length > 0) {
      await requireWorkspaceLead(this.deps.workspaces, input.workspaceId, input.actorUserId);
      const projects = await this.deps.projectAccess?.listProjects(input.workspaceId) ?? [];
      if (excludedProjectIds.some((id) => !projects.some((p) => p.id === id))) throw new ProjectNotFoundError();
    }
    // An editor cannot use an invitation to regain access via a second account.
    // Preserve their own restrictions without exposing hidden project names in the UI.
    if (actor.role === 'editor' && this.deps.projectAccess) {
      const exclusions = await this.deps.projectAccess.listExclusions(input.workspaceId);
      excludedProjectIds.push(...exclusions.filter((e) => e.userId === input.actorUserId).map((e) => e.projectId));
    }

    const email = input.email?.trim().toLowerCase() || null;
    const recipient = email ? await this.deps.users.getByEmail(email) : null;
    if (recipient && await this.deps.workspaces.getMembership(input.workspaceId, recipient.id)) throw new WorkspaceInviteMemberExistsError();
    const id = this.deps.idGen();
    const queuedAt = this.deps.now();
    const invite = await this.deps.invites.create({
      id, workspaceId: input.workspaceId, role: input.role,
      token: this.deps.randomToken(), email, excludedProjectIds,
      expiresAt: new Date(queuedAt.getTime() + this.deps.ttlMs),
      createdByUserId: input.actorUserId, queuedAt,
    });
    const reused = invite.id !== id;
    if (!reused && email) this.deps.onQueued?.();
    return { invite, reused, canShare: actor.role !== 'editor' || invite.createdByUserId === input.actorUserId };
  }
}
