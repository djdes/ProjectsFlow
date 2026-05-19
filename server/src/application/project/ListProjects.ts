import type { Project } from '../../domain/project/Project.js';
import type { ProjectRole } from '../../domain/project/ProjectMembership.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';

// Multi-tenancy: возвращаем все проекты в которых юзер состоит (owner / editor / viewer)
// + его role, чтобы клиент мог рисовать бейдж рядом с названием.
export type ProjectWithRole = Project & { readonly role: ProjectRole };

export class ListProjects {
  constructor(private readonly members: ProjectMemberRepository) {}

  execute(userId: string): Promise<ProjectWithRole[]> {
    return this.members.listProjectsForUser(userId);
  }
}
