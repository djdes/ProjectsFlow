import {
  ProjectInviteAlreadyUsedError,
  ProjectInviteExpiredError,
  ProjectInviteNotFoundError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import {
  WorkspaceInviteAlreadyUsedError,
  WorkspaceInviteExpiredError,
  WorkspaceNotFoundError,
} from '../../domain/workspace/errors.js';
import type { ProjectInvite } from '../../domain/project/ProjectInvite.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';

// Узкие структурные порты — реальные репозитории им соответствуют, тесты фейкают только их.
type ProjectInvitesPort = {
  findByToken(token: string): Promise<ProjectInvite | null>;
};
type WorkspaceInvitesPort = {
  findByToken(token: string): Promise<WorkspaceInvite | null>;
};
type ProjectsPort = { getById(id: string): Promise<{ name: string } | null> };
type WorkspacesPort = { getById(id: string): Promise<{ name: string } | null> };
type UsersPort = { getById(id: string): Promise<{ displayName: string } | null> };

type Deps = {
  readonly invites: ProjectInvitesPort;
  readonly workspaceInvites: WorkspaceInvitesPort;
  readonly projects: ProjectsPort;
  readonly workspaces: WorkspacesPort;
  readonly users: UsersPort;
  readonly now: () => Date;
};

// Preview для anon-страницы /invite/:token. Токены двух поколений (спека §3.2):
// сначала workspace_invites, затем легаси project_invites. ID цели не отдаём —
// у анона нет повода знать его до accept'а (защита от перебора).
export type InvitePreview = {
  readonly kind: 'workspace' | 'project';
  readonly targetName: string;
  readonly role: 'editor' | 'viewer';
  readonly inviterDisplayName: string | null;
  readonly inviteEmail: string | null;
  readonly expiresAt: Date;
};

export class GetInviteByToken {
  constructor(private readonly deps: Deps) {}

  async execute(token: string): Promise<InvitePreview> {
    const wsInvite = await this.deps.workspaceInvites.findByToken(token);
    if (wsInvite) {
      if (wsInvite.acceptedAt !== null) throw new WorkspaceInviteAlreadyUsedError();
      if (wsInvite.expiresAt.getTime() < this.deps.now().getTime()) {
        throw new WorkspaceInviteExpiredError();
      }
      const ws = await this.deps.workspaces.getById(wsInvite.workspaceId);
      if (!ws) throw new WorkspaceNotFoundError();
      const inviter = await this.deps.users.getById(wsInvite.createdByUserId);
      return {
        kind: 'workspace',
        targetName: ws.name,
        role: wsInvite.role,
        inviterDisplayName: inviter?.displayName ?? null,
        inviteEmail: wsInvite.email,
        expiresAt: wsInvite.expiresAt,
      };
    }

    // Легаси project_invites (заморожены, но непринятые токены продолжают работать).
    const invite = await this.deps.invites.findByToken(token);
    if (!invite) throw new ProjectInviteNotFoundError();
    if (invite.acceptedAt !== null) throw new ProjectInviteAlreadyUsedError();
    if (invite.expiresAt.getTime() < this.deps.now().getTime()) {
      throw new ProjectInviteExpiredError();
    }
    const project = await this.deps.projects.getById(invite.projectId);
    if (!project) throw new ProjectNotFoundError();
    const inviter = await this.deps.users.getById(invite.createdByUserId);
    return {
      kind: 'project',
      targetName: project.name,
      role: invite.role,
      inviterDisplayName: inviter?.displayName ?? null,
      inviteEmail: invite.email,
      expiresAt: invite.expiresAt,
    };
  }
}
