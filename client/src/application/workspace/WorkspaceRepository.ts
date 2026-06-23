import type { Workspace, WorkspaceMember, WorkspaceRole } from '@/domain/workspace/Workspace';

export type CreateWorkspaceInput = {
  readonly name: string;
  readonly icon: string | null;
};

export type UpdateWorkspaceInput = {
  readonly name?: string;
  readonly icon?: string | null;
};

export interface WorkspaceRepository {
  list(): Promise<Workspace[]>;
  create(input: CreateWorkspaceInput): Promise<Workspace>;
  rename(id: string, patch: UpdateWorkspaceInput): Promise<Workspace>;
  switchCurrent(id: string): Promise<void>;
  remove(id: string): Promise<void>;

  listMembers(id: string): Promise<WorkspaceMember[]>;
  addMember(id: string, email: string, role: WorkspaceRole): Promise<WorkspaceMember>;
  changeMemberRole(id: string, userId: string, role: WorkspaceRole): Promise<void>;
  removeMember(id: string, userId: string): Promise<void>;

  listProjects(id: string): Promise<Array<{ id: string; name: string; icon: string | null }>>;
  moveProject(workspaceId: string, projectId: string, targetWorkspaceId: string): Promise<void>;
}
