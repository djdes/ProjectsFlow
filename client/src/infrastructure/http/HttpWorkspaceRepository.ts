import type {
  Workspace,
  WorkspaceKind,
  WorkspaceMember,
  WorkspaceRole,
} from '@/domain/workspace/Workspace';
import type { WorkspaceInvite, WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
import type {
  CreateWorkspaceInput,
  CreateWorkspaceInviteInput,
  UpdateWorkspaceInput,
  WorkspaceRepository,
} from '@/application/workspace/WorkspaceRepository';
import { httpClient } from './httpClient';

type WorkspaceDto = {
  id: string;
  name: string;
  icon: string | null;
  kind?: WorkspaceKind;
  ownerUserId: string;
  role?: WorkspaceRole;
  projectCount?: number;
  memberCount?: number;
  isCurrent?: boolean;
  createdAt: string;
};

type MemberDto = {
  userId: string;
  role: WorkspaceRole;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

type ProjectDto = { id: string; name: string; icon: string | null };

type WorkspaceInviteDto = {
  id: string;
  workspaceId: string;
  role: WorkspaceInviteRole;
  email: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  createdByUserId: string;
  createdAt: string;
  token?: string;
  url?: string;
};

function inviteFromDto(dto: WorkspaceInviteDto): WorkspaceInvite {
  return {
    ...dto,
    expiresAt: new Date(dto.expiresAt),
    acceptedAt: dto.acceptedAt ? new Date(dto.acceptedAt) : null,
    createdAt: new Date(dto.createdAt),
  };
}

function fromDto(dto: WorkspaceDto): Workspace {
  return {
    id: dto.id,
    name: dto.name,
    icon: dto.icon ?? null,
    // Старый бэк без kind → считаем командным (дефолт явно помечается миграцией db/079).
    kind: dto.kind ?? 'team',
    ownerUserId: dto.ownerUserId,
    role: dto.role ?? 'member',
    projectCount: dto.projectCount ?? 0,
    memberCount: dto.memberCount ?? 0,
    isCurrent: dto.isCurrent ?? false,
    createdAt: new Date(dto.createdAt),
  };
}

function memberFromDto(dto: MemberDto): WorkspaceMember {
  return {
    userId: dto.userId,
    role: dto.role,
    displayName: dto.displayName ?? null,
    email: dto.email ?? null,
    avatarUrl: dto.avatarUrl ?? null,
  };
}

export class HttpWorkspaceRepository implements WorkspaceRepository {
  async list(): Promise<Workspace[]> {
    const { workspaces } = await httpClient.get<{ workspaces: WorkspaceDto[] }>('/workspaces');
    return workspaces.map(fromDto);
  }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    const { workspace } = await httpClient.post<{ workspace: WorkspaceDto }>('/workspaces', {
      name: input.name,
      icon: input.icon,
    });
    return fromDto(workspace);
  }

  async rename(id: string, patch: UpdateWorkspaceInput): Promise<Workspace> {
    const { workspace } = await httpClient.patch<{ workspace: WorkspaceDto }>(
      `/workspaces/${id}`,
      patch,
    );
    return fromDto(workspace);
  }

  async switchCurrent(id: string): Promise<void> {
    await httpClient.put<void>('/workspaces/current', { workspaceId: id });
  }

  async remove(id: string): Promise<void> {
    await httpClient.delete<void>(`/workspaces/${id}`);
  }

  async listMembers(id: string): Promise<WorkspaceMember[]> {
    const { members } = await httpClient.get<{ members: MemberDto[] }>(`/workspaces/${id}/members`);
    return members.map(memberFromDto);
  }

  async addMember(id: string, email: string, role: WorkspaceRole): Promise<WorkspaceMember> {
    const { member } = await httpClient.post<{ member: MemberDto }>(`/workspaces/${id}/members`, {
      email,
      role,
    });
    return memberFromDto(member);
  }

  async changeMemberRole(id: string, userId: string, role: WorkspaceRole): Promise<void> {
    await httpClient.patch<void>(`/workspaces/${id}/members/${userId}`, { role });
  }

  async removeMember(id: string, userId: string): Promise<void> {
    await httpClient.delete<void>(`/workspaces/${id}/members/${userId}`);
  }

  async listInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
    const { invites } = await httpClient.get<{ invites: WorkspaceInviteDto[] }>(
      `/workspaces/${workspaceId}/invites`,
    );
    return invites.map(inviteFromDto);
  }

  async createInvite(
    workspaceId: string,
    input: CreateWorkspaceInviteInput,
  ): Promise<WorkspaceInvite> {
    const { invite } = await httpClient.post<{ invite: WorkspaceInviteDto }>(
      `/workspaces/${workspaceId}/invites`,
      input,
    );
    return inviteFromDto(invite);
  }

  async deleteInvite(workspaceId: string, inviteId: string): Promise<void> {
    await httpClient.delete<void>(`/workspaces/${workspaceId}/invites/${inviteId}`);
  }

  async listProjects(id: string): Promise<ProjectDto[]> {
    const { projects } = await httpClient.get<{ projects: ProjectDto[] }>(`/workspaces/${id}/projects`);
    return projects;
  }

  async moveProject(
    workspaceId: string,
    projectId: string,
    targetWorkspaceId: string,
  ): Promise<void> {
    await httpClient.post<void>(`/workspaces/${workspaceId}/projects/${projectId}/move`, {
      targetWorkspaceId,
    });
  }
}
