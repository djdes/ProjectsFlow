import {
  ProjectInviteAlreadyUsedError,
  ProjectInviteExpiredError,
  ProjectInviteNotFoundError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import type { ProjectInvite } from '../../domain/project/ProjectInvite.js';
import type {
  WorkspaceMember,
  WorkspaceRole,
} from '../../domain/workspace/WorkspaceMember.js';
import type { AcceptProjectInviteInput } from './ProjectInviteRepository.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';

// Узкие структурные порты (реальные projectRepo/workspaceRepo им соответствуют).
type InvitesPort = {
  findByToken(token: string): Promise<ProjectInvite | null>;
  markAccepted(input: AcceptProjectInviteInput): Promise<ProjectInvite | null>;
};
type ProjectsPort = {
  getWorkspaceId(projectId: string): Promise<string | null>;
};
type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
};

type Deps = {
  readonly invites: InvitesPort;
  readonly projects: ProjectsPort;
  readonly workspaces: WorkspacesPort;
  readonly now: () => Date;
  // Лента действий (best-effort). Опционально.
  readonly activityRecorder?: ActivityRecorder;
};

export type AcceptInviteResult = {
  readonly projectId: string;
};

// Легаси-токены project_invites заморожены (новые не создаются), но непринятые
// продолжают работать: accept зачисляет юзера в ПРОСТРАНСТВО проекта (спека §3.1) —
// он получает доступ ко всем проектам пространства, как и по workspace-инвайту.
export class AcceptProjectInvite {
  constructor(private readonly deps: Deps) {}

  async execute(token: string, userId: string): Promise<AcceptInviteResult> {
    const invite = await this.deps.invites.findByToken(token);
    if (!invite) throw new ProjectInviteNotFoundError();
    if (invite.acceptedAt !== null) throw new ProjectInviteAlreadyUsedError();
    const now = this.deps.now();
    if (invite.expiresAt.getTime() < now.getTime()) throw new ProjectInviteExpiredError();

    const workspaceId = await this.deps.projects.getWorkspaceId(invite.projectId);
    if (!workspaceId) throw new ProjectNotFoundError();

    // Уже участник пространства — роль не апгрейдим/даунгрейдим, просто потребляем токен.
    const existing = await this.deps.workspaces.getMembership(workspaceId, userId);
    if (!existing) {
      await this.deps.workspaces.addMember(workspaceId, userId, invite.role);
      // Лента действий проекта (best-effort): участник присоединился по инвайту.
      void this.deps.activityRecorder?.record({
        projectId: invite.projectId,
        actorUserId: userId,
        kind: 'member_added',
        payload: { targetUserId: userId, role: invite.role },
      });
    }

    await this.deps.invites.markAccepted({
      inviteId: invite.id,
      acceptedAt: now,
      acceptedByUserId: userId,
    });

    return { projectId: invite.projectId };
  }
}
