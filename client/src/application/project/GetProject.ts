import type { Project } from '@/domain/project/Project';
import type { ProjectRepository } from './ProjectRepository';

export class GetProject {
  constructor(private readonly repo: ProjectRepository) {}

  execute(id: string): Promise<Project | null> {
    return this.repo.getById(id);
  }
}
