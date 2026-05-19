import type { Project } from '@/domain/project/Project';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import type { ProjectInvite, ProjectInviteRole } from '@/domain/project/ProjectInvite';

export type CreateProjectInput = {
  readonly name: string;
};

// Patch-семантика: undefined = поле не меняется, null = очистить, string = новое значение.
export type UpdateProjectInput = {
  readonly name?: string;
  readonly gitRepoUrl?: string | null;
  readonly kbRepoFullName?: string | null;
};

export type CreateInviteInput = {
  readonly role: ProjectInviteRole;
  readonly email: string | null;
};

export interface ProjectRepository {
  list(): Promise<Project[]>;
  getById(id: string): Promise<Project | null>;
  // Inbox-проект юзера. Создаётся лениво при первом обращении на сервере.
  getInbox(): Promise<Project>;
  create(input: CreateProjectInput): Promise<Project>;
  update(id: string, patch: UpdateProjectInput): Promise<Project>;

  // Multi-tenancy: members + invites. Owner-only операции упадут 403 на сервере.
  listMembers(projectId: string): Promise<ProjectMember[]>;
  updateMemberRole(
    projectId: string,
    userId: string,
    role: Exclude<ProjectRole, 'owner'>,
  ): Promise<void>;
  removeMember(projectId: string, userId: string): Promise<void>;
  transferOwnership(projectId: string, toUserId: string): Promise<void>;
  listInvites(projectId: string): Promise<ProjectInvite[]>;
  createInvite(projectId: string, input: CreateInviteInput): Promise<ProjectInvite>;
  deleteInvite(projectId: string, inviteId: string): Promise<void>;
}
