import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type {
  ProjectMemberRepository,
  ProjectWithRole,
} from './ProjectMemberRepository.js';

// Both personal and team workspaces contain only their own accessible projects.
export type { ProjectWithRole };

type ActiveWorkspace = { readonly id: string; readonly kind: WorkspaceKind };

type Deps = {
  readonly members: ProjectMemberRepository;
  // Резолвит активное пространство юзера (id + kind). null = нет пространств → пустой список.
  readonly resolveActiveWorkspace: (userId: string) => Promise<ActiveWorkspace | null>;
};

export class ListProjects {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<ProjectWithRole[]> {
    const ws = await this.deps.resolveActiveWorkspace(userId);
    if (!ws) return [];
    return this.deps.members.listProjectsForUserInWorkspace(userId, ws.id);
  }
}
