import type { Project } from '@/domain/project/Project';
import type { ProjectRepository } from './ProjectRepository';

export class ListProjects {
  constructor(private readonly repo: ProjectRepository) {}

  execute(): Promise<Project[]> {
    return this.repo.list();
  }
}
