import type { ProjectMemberRepository } from './ProjectMemberRepository.js';

export type ReorderFavoriteProjectsCommand = {
  readonly userId: string;
  readonly orderedIds: readonly string[];
};

type Deps = {
  readonly members: ProjectMemberRepository;
};

// Симметрично ReorderProjects, но пишет favorite_sort_order. id, которые не входят в
// favorites юзера, репозиторий игнорирует (UPDATE с предикатом is_favorite=true).
export class ReorderFavoriteProjects {
  constructor(private readonly deps: Deps) {}

  execute(cmd: ReorderFavoriteProjectsCommand): Promise<void> {
    return this.deps.members.reorderFavoritesForUser(cmd.userId, cmd.orderedIds);
  }
}
