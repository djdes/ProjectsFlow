import type { ProjectStatus } from '../../domain/project/Project.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';

type Deps = {
  readonly members: ProjectMemberRepository;
};

export type AdminProjectFavoriteView = {
  readonly projectId: string;
  readonly projectName: string;
  readonly status: ProjectStatus;
  readonly isInbox: boolean;
  // Персональный favorite-флаг target-юзера в этом проекте + его порядок в «Избранном».
  readonly isFavorite: boolean;
  readonly favoriteSortOrder: number;
};

// Admin-only: список проектов конкретного юзера (любые роли, кроме inbox) с его персональным
// favorite-флагом. Admin через диалог «Избранное» включает/выключает favorite за этого юзера.
// Access-check (isAdmin) — на уровне presentation (route уже под admin-middleware).
export class ListUserProjectsWithFavorites {
  constructor(private readonly deps: Deps) {}

  async execute(targetUserId: string): Promise<AdminProjectFavoriteView[]> {
    const all = await this.deps.members.listProjectsForUser(targetUserId);
    // inbox favorite'ить нельзя — исключаем из управляемого списка.
    const manageable = all.filter((p) => !p.isInbox);
    // favorites сверху (по favoriteSortOrder), затем остальные по имени.
    manageable.sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      if (a.isFavorite && b.isFavorite) return a.favoriteSortOrder - b.favoriteSortOrder;
      return a.name.localeCompare(b.name, 'ru');
    });
    return manageable.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      status: p.status,
      isInbox: p.isInbox,
      isFavorite: p.isFavorite,
      favoriteSortOrder: p.favoriteSortOrder,
    }));
  }
}
