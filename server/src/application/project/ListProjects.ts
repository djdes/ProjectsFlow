import type {
  ProjectMemberRepository,
  ProjectWithRole,
} from './ProjectMemberRepository.js';

// Multi-tenancy: возвращаем проекты АКТИВНОГО пространства, в которых юзер состоит
// (owner / editor / viewer) + его role + read-model счётчики (members/tasks).
export type { ProjectWithRole };

type Deps = {
  readonly members: ProjectMemberRepository;
  // Резолвит активное пространство юзера (current ?? первое доступное). null = нет пространств.
  readonly resolveWorkspaceId: (userId: string) => Promise<string | null>;
};

export class ListProjects {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<ProjectWithRole[]> {
    const workspaceId = await this.deps.resolveWorkspaceId(userId);
    if (!workspaceId) return [];
    return this.deps.members.listProjectsForUserInWorkspace(userId, workspaceId);
  }
}
