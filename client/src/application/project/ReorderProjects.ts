import type { ProjectRepository } from './ProjectRepository';

// Персональная пересортировка проектов в сайдбаре. orderedIds — полный список id
// в желаемом порядке.
export class ReorderProjects {
  constructor(private readonly repo: ProjectRepository) {}

  execute(orderedIds: readonly string[]): Promise<void> {
    return this.repo.reorder(orderedIds);
  }
}
