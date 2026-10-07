export type WorkspaceAccessProject = { id: string; name: string; icon: string | null };
export type ProjectExclusion = { projectId: string; userId: string };

export interface WorkspaceProjectAccessRepository {
  listProjects(workspaceId: string): Promise<WorkspaceAccessProject[]>;
  listExclusions(workspaceId: string): Promise<ProjectExclusion[]>;
  setAccess(workspaceId: string, projectId: string, userId: string, visible: boolean): Promise<void>;
}
