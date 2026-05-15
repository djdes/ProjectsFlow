import type { Project } from '../../domain/project/Project.js';
import type { ProjectRepository } from './ProjectRepository.js';

export class ListProjects {
  constructor(private readonly repo: ProjectRepository) {}

  execute(ownerId: string): Promise<Project[]> {
    return this.repo.listByOwner(ownerId);
  }
}
