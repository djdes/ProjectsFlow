import type { Project } from '../../domain/project/Project.js';
import type { ProjectRepository } from './ProjectRepository.js';

export class GetProject {
  constructor(private readonly repo: ProjectRepository) {}

  // Возвращает null если проект не принадлежит owner'у — presentation отдаёт 404,
  // не утекая существование чужого ресурса.
  execute(id: string, ownerId: string): Promise<Project | null> {
    return this.repo.getByIdForOwner(id, ownerId);
  }
}
