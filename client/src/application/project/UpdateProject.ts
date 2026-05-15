import type { Project } from '@/domain/project/Project';
import type { ProjectRepository, UpdateProjectInput } from './ProjectRepository';

export class UpdateProject {
  constructor(private readonly repo: ProjectRepository) {}

  execute(id: string, patch: UpdateProjectInput): Promise<Project> {
    return this.repo.update(id, patch);
  }
}
