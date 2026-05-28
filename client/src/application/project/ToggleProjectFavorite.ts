import type { ProjectRepository } from './ProjectRepository';

// Toggle favorite-флага проекта в сайдбаре. Per-user; разрешено любому члену проекта.
export class ToggleProjectFavorite {
  constructor(private readonly repo: ProjectRepository) {}

  execute(projectId: string, favorite: boolean): Promise<void> {
    return this.repo.toggleFavorite(projectId, favorite);
  }
}
