import type { ProjectRepository } from './ProjectRepository';

// Пересортировка проектов внутри секции «Избранное» сайдбара. Симметрично
// ReorderProjects, но затрагивает только favorite_sort_order на сервере.
export class ReorderFavoriteProjects {
  constructor(private readonly repo: ProjectRepository) {}

  execute(orderedIds: readonly string[]): Promise<void> {
    return this.repo.reorderFavorites(orderedIds);
  }
}
