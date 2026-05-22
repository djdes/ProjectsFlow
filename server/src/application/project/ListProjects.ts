import type {
  ProjectMemberRepository,
  ProjectWithRole,
} from './ProjectMemberRepository.js';

// Multi-tenancy: возвращаем все проекты в которых юзер состоит (owner / editor / viewer)
// + его role + read-model счётчики (members/tasks). Единый источник типа — репозиторий.
export type { ProjectWithRole };

export class ListProjects {
  constructor(private readonly members: ProjectMemberRepository) {}

  execute(userId: string): Promise<ProjectWithRole[]> {
    return this.members.listProjectsForUser(userId);
  }
}
