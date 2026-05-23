import type { Project, ProjectStatus } from '@/domain/project/Project';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import type { ProjectInvite, ProjectInviteRole } from '@/domain/project/ProjectInvite';
import { ProjectNameAlreadyExistsError } from '@/domain/project/errors';
import type {
  CreateInviteInput,
  CreateProjectInput,
  DispatcherCandidate,
  GitCollision,
  ProjectRepository,
  UpdateProjectInput,
} from '@/application/project/ProjectRepository';
import type { NotificationPrefs } from '@/domain/notifications/NotificationPrefs';
import { HttpError, httpClient } from './httpClient';

type ProjectDto = {
  id: string;
  ownerId: string;
  name: string;
  status: ProjectStatus;
  gitRepoUrl: string | null;
  kbRepoFullName: string | null;
  isInbox?: boolean;
  role?: ProjectRole;
  memberCount?: number;
  taskCount?: number;
  kbKind?: 'none' | 'github' | 'local';
  financeVisibility?: 'owner' | 'members';
  dispatcherUserId?: string | null;
  createdAt: string;
};

function fromDto(dto: ProjectDto): Project {
  return {
    id: dto.id,
    name: dto.name,
    status: dto.status,
    gitRepoUrl: dto.gitRepoUrl,
    kbRepoFullName: dto.kbRepoFullName ?? null,
    kbKind: dto.kbKind ?? (dto.kbRepoFullName ? 'github' : 'none'),
    isInbox: dto.isInbox ?? false,
    // Legacy-fallback: до P3-релиза сервера role могло не быть в ответе. Дефолт 'owner'
    // — для single-tenant юзеров это и так было true, UI не сломается.
    role: dto.role ?? 'owner',
    memberCount: dto.memberCount,
    taskCount: dto.taskCount,
    financeVisibility: dto.financeVisibility ?? 'owner',
    dispatcherUserId: dto.dispatcherUserId ?? null,
    createdAt: new Date(dto.createdAt),
  };
}

type MemberDto = {
  projectId: string;
  userId: string;
  role: ProjectRole;
  joinedAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
  };
};

function memberFromDto(dto: MemberDto): ProjectMember {
  return {
    projectId: dto.projectId,
    userId: dto.userId,
    role: dto.role,
    joinedAt: new Date(dto.joinedAt),
    user: dto.user,
  };
}

type InviteDto = {
  id: string;
  projectId: string;
  role: ProjectInviteRole;
  email: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  createdByUserId: string;
  createdAt: string;
  token?: string;
  url?: string;
};

function inviteFromDto(dto: InviteDto): ProjectInvite {
  return {
    id: dto.id,
    projectId: dto.projectId,
    role: dto.role,
    email: dto.email,
    expiresAt: new Date(dto.expiresAt),
    acceptedAt: dto.acceptedAt ? new Date(dto.acceptedAt) : null,
    acceptedByUserId: dto.acceptedByUserId,
    createdByUserId: dto.createdByUserId,
    createdAt: new Date(dto.createdAt),
    token: dto.token,
    url: dto.url,
  };
}

export class HttpProjectRepository implements ProjectRepository {
  async list(): Promise<Project[]> {
    const { projects } = await httpClient.get<{ projects: ProjectDto[] }>('/projects');
    return projects.map(fromDto);
  }

  async getById(id: string): Promise<Project | null> {
    try {
      const { project } = await httpClient.get<{ project: ProjectDto }>(`/projects/${id}`);
      return fromDto(project);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  async getInbox(): Promise<Project> {
    const { project } = await httpClient.get<{ project: ProjectDto }>('/inbox');
    return fromDto(project);
  }

  async create(input: CreateProjectInput): Promise<Project> {
    try {
      const { project } = await httpClient.post<{ project: ProjectDto }>('/projects', {
        name: input.name,
      });
      return fromDto(project);
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        throw new ProjectNameAlreadyExistsError(input.name);
      }
      throw err;
    }
  }

  async update(id: string, patch: UpdateProjectInput): Promise<Project> {
    try {
      const { project } = await httpClient.patch<{ project: ProjectDto }>(
        `/projects/${id}`,
        patch,
      );
      return fromDto(project);
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        throw new ProjectNameAlreadyExistsError(patch.name ?? '');
      }
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${id}`);
  }

  async listDispatcherCandidates(projectId: string): Promise<DispatcherCandidate[]> {
    const { candidates } = await httpClient.get<{ candidates: DispatcherCandidate[] }>(
      `/projects/${projectId}/dispatcher-candidates`,
    );
    return candidates;
  }

  async setDispatcher(projectId: string, userId: string | null): Promise<Project> {
    const { project } = await httpClient.put<{ project: ProjectDto }>(
      `/projects/${projectId}/dispatcher`,
      { userId },
    );
    return fromDto(project);
  }

  async reorder(orderedIds: readonly string[]): Promise<void> {
    await httpClient.put<void>('/projects/reorder', { orderedIds });
  }

  async getNotificationPrefs(projectId: string): Promise<NotificationPrefs> {
    const { prefs } = await httpClient.get<{ prefs: NotificationPrefs }>(
      `/projects/${projectId}/notification-prefs`,
    );
    return prefs;
  }

  async setNotificationPrefs(
    projectId: string,
    prefs: NotificationPrefs,
  ): Promise<NotificationPrefs> {
    const { prefs: saved } = await httpClient.put<{ prefs: NotificationPrefs }>(
      `/projects/${projectId}/notification-prefs`,
      { prefs },
    );
    return saved;
  }

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    const { members } = await httpClient.get<{ members: MemberDto[] }>(
      `/projects/${projectId}/members`,
    );
    return members.map(memberFromDto);
  }

  async updateMemberRole(
    projectId: string,
    userId: string,
    role: Exclude<ProjectRole, 'owner'>,
  ): Promise<void> {
    await httpClient.patch<unknown>(`/projects/${projectId}/members/${userId}`, { role });
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/members/${userId}`);
  }

  async transferOwnership(projectId: string, toUserId: string): Promise<void> {
    await httpClient.post<void>(`/projects/${projectId}/transfer`, { toUserId });
  }

  async listInvites(projectId: string): Promise<ProjectInvite[]> {
    const { invites } = await httpClient.get<{ invites: InviteDto[] }>(
      `/projects/${projectId}/invites`,
    );
    return invites.map(inviteFromDto);
  }

  async createInvite(projectId: string, input: CreateInviteInput): Promise<ProjectInvite> {
    const { invite } = await httpClient.post<{ invite: InviteDto }>(
      `/projects/${projectId}/invites`,
      input,
    );
    return inviteFromDto(invite);
  }

  async deleteInvite(projectId: string, inviteId: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/invites/${inviteId}`);
  }

  async checkGitCollision(gitRepoUrl: string): Promise<GitCollision> {
    return httpClient.get<GitCollision>(
      `/projects/git-collision?url=${encodeURIComponent(gitRepoUrl)}`,
    );
  }

  async requestJoin(projectId: string): Promise<void> {
    await httpClient.post<unknown>(`/projects/${projectId}/join-requests`);
  }

  async resolveJoinRequest(requestId: string, accept: boolean): Promise<void> {
    await httpClient.post<unknown>(`/projects/join-requests/${requestId}/resolve`, { accept });
  }
}
