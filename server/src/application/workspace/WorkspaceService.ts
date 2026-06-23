import type { Workspace } from '../../domain/workspace/Workspace.js';
import type {
  WorkspaceMember,
  WorkspaceRole,
} from '../../domain/workspace/WorkspaceMember.js';
import {
  WorkspaceNameEmptyError,
  WorkspaceNotFoundError,
  NotWorkspaceMemberError,
  NotProjectOwnerError,
  LastOwnerError,
  WorkspaceNotEmptyError,
  CannotDeleteLastWorkspaceError,
  UserNotFoundByEmailError,
} from '../../domain/workspace/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import {
  requireWorkspaceMember,
  requireWorkspaceOwner,
} from './workspaceAccess.js';
import type {
  WorkspaceRepository,
  WorkspaceListItem,
} from './WorkspaceRepository.js';

// Узкие структурные порты — нужны только методы ниже; реальные репозитории их содержат.
type ProjectsPort = {
  getById(id: string): Promise<{ id: string; ownerId: string } | null>;
  setWorkspace(projectId: string, workspaceId: string): Promise<void>;
  listByWorkspace(workspaceId: string): Promise<ReadonlyArray<{ id: string; name: string; icon: string | null }>>;
};
type ProjectMembersPort = {
  listByProject(projectId: string): Promise<ReadonlyArray<{ userId: string }>>;
};
type UsersPort = {
  getByEmail(email: string): Promise<{ id: string } | null>;
};

type Deps = {
  readonly repo: WorkspaceRepository;
  readonly projects: ProjectsPort;
  readonly projectMembers: ProjectMembersPort;
  readonly users: UsersPort;
  readonly idGen: () => string;
};

export class WorkspaceService {
  constructor(private readonly deps: Deps) {}

  listForUser(userId: string): Promise<WorkspaceListItem[]> {
    return this.deps.repo.listForUser(userId);
  }

  getCurrentWorkspaceId(userId: string): Promise<string | null> {
    return this.deps.repo.getCurrentWorkspaceId(userId);
  }

  /** Проекты пространства (для страницы настроек). Только участник пространства. */
  async listProjects(
    workspaceId: string,
    userId: string,
  ): Promise<ReadonlyArray<{ id: string; name: string; icon: string | null }>> {
    await requireWorkspaceMember(this.deps.repo, workspaceId, userId);
    return this.deps.projects.listByWorkspace(workspaceId);
  }

  async create(userId: string, input: { name: string; icon: string | null }): Promise<Workspace> {
    const name = input.name.trim();
    if (name.length === 0) throw new WorkspaceNameEmptyError();
    const ws = await this.deps.repo.createWithOwnerMembership({
      id: this.deps.idGen(),
      name,
      icon: input.icon ?? null,
      ownerUserId: userId,
    });
    await this.deps.repo.setCurrentWorkspace(userId, ws.id);
    return ws;
  }

  async rename(
    workspaceId: string,
    userId: string,
    patch: { name?: string; icon?: string | null },
  ): Promise<Workspace> {
    await requireWorkspaceOwner(this.deps.repo, workspaceId, userId);
    let name: string | undefined;
    if (patch.name !== undefined) {
      name = patch.name.trim();
      if (name.length === 0) throw new WorkspaceNameEmptyError();
    }
    const updated = await this.deps.repo.update(workspaceId, { name, icon: patch.icon });
    if (!updated) throw new WorkspaceNotFoundError();
    return updated;
  }

  async switchCurrent(userId: string, workspaceId: string): Promise<void> {
    await requireWorkspaceMember(this.deps.repo, workspaceId, userId);
    await this.deps.repo.setCurrentWorkspace(userId, workspaceId);
  }

  async listMembers(workspaceId: string, userId: string): Promise<WorkspaceMember[]> {
    await requireWorkspaceMember(this.deps.repo, workspaceId, userId);
    return this.deps.repo.listMembers(workspaceId);
  }

  async addMember(
    workspaceId: string,
    actorId: string,
    email: string,
    role: WorkspaceRole = 'member',
  ): Promise<WorkspaceMember> {
    await requireWorkspaceOwner(this.deps.repo, workspaceId, actorId);
    const user = await this.deps.users.getByEmail(email.trim());
    if (!user) throw new UserNotFoundByEmailError(email);
    await this.deps.repo.addMember(workspaceId, user.id, role);
    const m = await this.deps.repo.getMembership(workspaceId, user.id);
    if (!m) throw new WorkspaceNotFoundError();
    return m;
  }

  async changeMemberRole(
    workspaceId: string,
    actorId: string,
    targetUserId: string,
    role: WorkspaceRole,
  ): Promise<void> {
    await requireWorkspaceOwner(this.deps.repo, workspaceId, actorId);
    const target = await this.deps.repo.getMembership(workspaceId, targetUserId);
    if (!target) throw new NotWorkspaceMemberError();
    // Понижение owner'а до member: нельзя оставить пространство без владельца.
    if (target.role === 'owner' && role === 'member') {
      const owners = await this.deps.repo.countOwners(workspaceId);
      if (owners <= 1) throw new LastOwnerError();
    }
    await this.deps.repo.setMemberRole(workspaceId, targetUserId, role);
  }

  async removeMember(
    workspaceId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    await requireWorkspaceOwner(this.deps.repo, workspaceId, actorId);
    const target = await this.deps.repo.getMembership(workspaceId, targetUserId);
    if (!target) throw new NotWorkspaceMemberError();
    if (target.role === 'owner') {
      const owners = await this.deps.repo.countOwners(workspaceId);
      if (owners <= 1) throw new LastOwnerError();
    }
    await this.deps.repo.removeMember(workspaceId, targetUserId);
    // Если у удалённого это было активное пространство — переключаем на другое.
    const current = await this.deps.repo.getCurrentWorkspaceId(targetUserId);
    if (current === workspaceId) {
      const another = await this.deps.repo.findAnotherForUser(targetUserId, workspaceId);
      if (another) await this.deps.repo.setCurrentWorkspace(targetUserId, another);
    }
  }

  async moveProject(
    workspaceId: string,
    userId: string,
    projectId: string,
    targetWorkspaceId: string,
  ): Promise<void> {
    await requireWorkspaceMember(this.deps.repo, workspaceId, userId);
    await requireWorkspaceMember(this.deps.repo, targetWorkspaceId, userId);
    const project = await this.deps.projects.getById(projectId);
    if (!project) throw new ProjectNotFoundError();
    if (project.ownerId !== userId) throw new NotProjectOwnerError();
    await this.deps.projects.setWorkspace(projectId, targetWorkspaceId);
    // Все участники проекта должны стать участниками целевого пространства (идемпотентно).
    const members = await this.deps.projectMembers.listByProject(projectId);
    for (const m of members) {
      await this.deps.repo.addMember(targetWorkspaceId, m.userId, 'member');
    }
  }

  async deleteWorkspace(workspaceId: string, userId: string): Promise<void> {
    await requireWorkspaceOwner(this.deps.repo, workspaceId, userId);
    const projects = await this.deps.repo.projectCount(workspaceId);
    if (projects > 0) throw new WorkspaceNotEmptyError();
    const total = await this.deps.repo.countForUser(userId);
    if (total <= 1) throw new CannotDeleteLastWorkspaceError();
    await this.deps.repo.delete(workspaceId);
    // current_workspace_id обнуляется ON DELETE SET NULL — переключаем на другое явно.
    const current = await this.deps.repo.getCurrentWorkspaceId(userId);
    if (current === null || current === workspaceId) {
      const another = await this.deps.repo.findAnotherForUser(userId, workspaceId);
      if (another) await this.deps.repo.setCurrentWorkspace(userId, another);
    }
  }
}
